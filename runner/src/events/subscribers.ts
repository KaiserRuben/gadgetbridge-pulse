/**
 * Event subscribers — pipeline work attached to bus events.
 *
 * Per-cluster wiring:
 *   sleep_complete   → sleep + recovery clusters (both depend on overnight
 *                      HRV / RHR / SpO₂ landing with the wake row)
 *   workout_complete → activity cluster
 *   day_end          → v2 full pipeline + v3 full (synthesis + sentinel)
 *   manual           → same as day_end
 *
 * Bus serialises per periodKey, so multiple events on the same date queue
 * behind one another and the GPU stays single-tenant. Different periodKeys
 * may proceed concurrently, but the Ollama server itself enforces a single
 * generation lane in practice.
 */

import { log } from "../logger.ts";
import { isDailyFinalised, isV3Finalised } from "../period.ts";
import { runDaily } from "../v2-orchestrator.ts";
import { runV3, runV3Cluster, type V3Cluster } from "../v3-orchestrator.ts";
import { runNutritionCluster } from "../v3/packagers/nutrition.ts";
import { reconcileMeals } from "../nutrition/reconciler.ts";
import { pushNotify } from "../ingest/client.ts";
import { runStage } from "../state/run-stage.ts";
import { bus, type PulseEvent } from "./bus.ts";
import { registerCellDispatcher } from "./cell-dispatcher.ts";

async function runCluster(cluster: V3Cluster, periodKey: string): Promise<void> {
  await runStage(
    { cluster: `v3:${cluster}`, key: periodKey, tag: `v3:${cluster}` },
    async () => {
      try {
        const r = await runV3Cluster(cluster, { periodKey });
        if (r.ok) {
          log.info("sub", `${cluster} ok ${r.totalMs}ms${r.skipped ? " (reused)" : ""}`);
        } else {
          log.error("sub", `${cluster} fail ${r.totalMs}ms — ${r.errors.join("|") || "?"}`);
          throw new Error(r.errors.join("|") || "v3 cluster failed");
        }
      } catch (err) {
        log.error("sub", `${cluster} crashed: ${(err as Error).message}`);
        throw err;
      }
    },
  ).catch(() => undefined); // runStage already records the failure
}

async function onSleepComplete(ev: PulseEvent): Promise<void> {
  log.info(
    "sub",
    `sleep_complete wake=${ev.payload.wake_iso ?? "?"} → sleep+recovery+morning`,
  );
  await runCluster("sleep", ev.periodKey);
  await runCluster("recovery", ev.periodKey);
  // Morning briefing reads from the just-written sleep + recovery insights
  // (plus the training plan + pain history + lever math), so it must
  // sequentially follow the two clusters above. Bus serialisation per
  // periodKey already prevents concurrent runs on the same date.
  await runCluster("morning", ev.periodKey);
  // Notify after the sleep+recovery chain settles. Duration derived from
  // bedtime/wake stamps in the bus payload; deep/rem stay null here (the
  // renderer's fallback handles that gracefully — body becomes just the
  // "Schlaf Xh Ymin" header).
  const bed = parseIso(ev.payload.bedtime_iso);
  const wake = parseIso(ev.payload.wake_iso);
  const totalMin =
    bed != null && wake != null ? Math.max(0, Math.round((wake - bed) / 60_000)) : null;
  void pushNotify({
    topic: "sleep_complete",
    periodKey: ev.periodKey,
    dedupeKey: `sleep_complete:${ev.periodKey}`,
    context: totalMin != null ? { total_min: totalMin } : {},
    priority: "normal",
  }).catch((err) => log.warn("sub", `pushNotify sleep: ${err}`));
}

function parseIso(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

async function onWorkoutComplete(ev: PulseEvent): Promise<void> {
  log.info(
    "sub",
    `workout_complete duration=${ev.payload.duration_min ?? "?"}min → activity+training`,
  );
  await runCluster("activity", ev.periodKey);
  // Training cluster fires alongside activity so a completed gym session
  // surfaces both wearable-derived activity KPIs and plan-aware quality
  // commentary (post-session). The packager picks up the just-finished
  // ActualSession via the PULSE_ACTUAL_SESSION table.
  await runCluster("training", ev.periodKey);
  // Notify when both clusters have settled. dedupe keyed on the workout end
  // stamp so two workouts on the same day each get their own ping. Numbers
  // here are coarse — the Pi-side renderer composes a German one-liner.
  const endIso = typeof ev.payload.end_iso === "string" ? ev.payload.end_iso : "";
  void pushNotify({
    topic: "workout_complete",
    periodKey: ev.periodKey,
    dedupeKey: `workout_complete:${endIso || ev.periodKey}`,
    context: {
      type: "Workout",
      ...(typeof ev.payload.duration_min === "number"
        ? { duration_min: ev.payload.duration_min }
        : {}),
    },
    priority: "normal",
  }).catch((err) => log.warn("sub", `pushNotify workout: ${err}`));
}

async function onDayEnd(ev: PulseEvent): Promise<void> {
  const v2Done = isDailyFinalised(ev.periodKey);
  const v3Done = isV3Finalised(ev.periodKey);
  if (v2Done && v3Done) {
    log.info("sub", "day_end already final, skip");
    return;
  }
  log.info("sub", `day_end v2=${v2Done ? "done" : "pending"} v3=${v3Done ? "done" : "pending"}`);
  // v2 first (writes the canonical daily.json + sentinel). v3 second so the
  // synthesis sees end-of-day numbers and any earlier cluster refreshes.
  //
  // We capture the daily's headline/action here so the notify post-step
  // below can use the Stage 4 prose verbatim (it's already German,
  // observational, and length-bounded by the schema).
  // The closure inside `runStage` assigns to these; TS otherwise narrows the
  // outer binding to the literal `null` because the assignment lives inside
  // an awaited async lambda that the analyser doesn't trace.
  let v2Headline = null as string | null;
  let v2ActionTiny = null as string | null;
  let v2Ok = false as boolean;
  if (!v2Done) {
    await runStage({ cluster: "v2", key: ev.periodKey, tag: "v2" }, async () => {
      const v2 = await runDaily(ev.periodKey, {});
      if (!v2.ok) {
        log.error("sub", `v2 failed: ${v2.error}`);
        throw new Error(v2.error ?? "v2 failed");
      }
      log.info(
        "sub",
        `v2 done pipeline=${v2.bundle.pipeline_status} verify=${v2.verify.ok ? "ok" : "fail"}`,
      );
      v2Ok =
        v2.verify.ok &&
        (v2.bundle.pipeline_status === "ok" || v2.bundle.pipeline_status === "live");
      v2Headline = v2.daily.headline;
      v2ActionTiny = v2.daily.action?.tiny ?? null;
    }).catch(() => undefined);
  }
  if (!v3Done) {
    await runStage({ cluster: "v3", key: ev.periodKey, tag: "v3" }, async () => {
      try {
        const v3 = await runV3({ periodKey: ev.periodKey });
        if (v3.ok) {
          log.info("sub", `v3 done ${v3.totalMs}ms`);
        } else {
          log.error("sub", `v3 fail ${v3.totalMs}ms — ${v3.errors.join("|") || "?"}`);
          throw new Error(v3.errors.join("|") || "v3 failed");
        }
      } catch (err) {
        log.error("sub", `v3 crashed: ${(err as Error).message}`);
        throw err;
      }
    }).catch(() => undefined);
  }

  // Nutrition cluster runs after v3 — day_complete=true means Stage C marks
  // the insight `complete`. Standalone of v3 (doesn't share its completion
  // log) so a missing classified meal photo doesn't block the rest of v3.
  await runStage(
    { cluster: "nutrition", key: ev.periodKey, tag: "nutrition" },
    async () => {
      try {
        const n = await runNutritionCluster({ periodKey: ev.periodKey, day_complete: true });
        if (!n.ok) {
          log.warn("sub", `nutrition cluster fail: ${n.error}`);
          throw new Error(n.error ?? "nutrition failed");
        }
      } catch (err) {
        log.error("sub", `nutrition cluster crashed: ${(err as Error).message}`);
        throw err;
      }
    },
  ).catch(() => undefined);

  // Finalize notification. Headline + action.tiny are Stage 4 prose (German,
  // observational, length-capped by schema). The Pi's renderer guards
  // against exclamation/emoji and falls back to the deterministic context
  // path if either field violates the rule.
  if (v2Ok && (v2Headline || v2ActionTiny)) {
    const title = v2Headline?.trim() || "Tag fertig";
    const body = v2ActionTiny?.trim() || v2Headline?.trim() || "";
    void pushNotify({
      topic: "day_finalized",
      periodKey: ev.periodKey,
      dedupeKey: `day_finalized:${ev.periodKey}`,
      hint: body
        ? {
            topic: "day_finalized",
            title: title.slice(0, 40),
            body: body.slice(0, 90),
            url: `/?d=${ev.periodKey}`,
            dedupeKey: `day_finalized:${ev.periodKey}`,
          }
        : undefined,
      context: {
        headline: v2Headline ?? undefined,
        next_action: v2ActionTiny ?? undefined,
      },
      url: `/?d=${ev.periodKey}`,
      priority: "normal",
    }).catch((err) => log.warn("sub", `pushNotify day_finalized: ${err}`));
  }
}

function onManual(ev: PulseEvent): Promise<void> {
  log.info("sub", "manual trigger");
  return onDayEnd(ev);
}

// ── Nutrition events ─────────────────────────────────────────────────────────
//
// `meal_logged_pending` is now a wake-up hint for the reconciler — the Pi
// emits it after the upload route inserts a row (if/when the optional
// webhook is wired). The reconciler itself drains pulse.db on a short tick
// regardless, so this handler is a latency optimisation, not the queue.
//
// `meal_classified` / `meal_edited` run the day-level multi-image
// aggregator (debounced via the bus's per-periodKey queue) so the
// dashboard's day_pattern stays fresh without spamming the GPU.

async function onMealLoggedPending(_ev: PulseEvent): Promise<void> {
  await reconcileMeals();
}

async function onMealClassifiedOrEdited(ev: PulseEvent): Promise<void> {
  log.info("sub", `${ev.kind} → nutrition cluster ${ev.periodKey}`);
  await runStage(
    { cluster: "nutrition", key: ev.periodKey, tag: "nutrition", stage: ev.kind },
    async () => {
      const r = await runNutritionCluster({ periodKey: ev.periodKey });
      if (!r.ok) {
        log.warn("sub", `nutrition cluster fail: ${r.error}`);
        throw new Error(r.error ?? "nutrition failed");
      }
    },
  ).catch(() => undefined);
}

export function registerSubscribers(): void {
  bus.on("day_end", onDayEnd);
  bus.on("sleep_complete", onSleepComplete);
  bus.on("workout_complete", onWorkoutComplete);
  bus.on("manual", onManual);
  bus.on("meal_logged_pending", onMealLoggedPending);
  bus.on("meal_classified", onMealClassifiedOrEdited);
  bus.on("meal_edited", onMealClassifiedOrEdited);
  // Phase 2a cell dispatcher: every event fans out across the cluster
  // registry, marking dependent cells stale and (if auto_process is on)
  // enqueueing them. Empty registry until clusters register entries.
  registerCellDispatcher();
}
