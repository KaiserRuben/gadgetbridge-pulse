/**
 * Event subscribers — pipeline work attached to bus events.
 *
 * The daily prose (v2) and the sleep/recovery/morning/activity v3 clusters +
 * v3 synthesis are now produced by the v4 view-state pipeline (the dashboard
 * reads view-state, not these JSONs), so they are no longer run here. What
 * remains event-driven:
 *   sleep_complete   → PWA notify (sleep insight now lives in view-state)
 *   workout_complete → training cluster (training/page.tsx still reads it) + notify
 *   day_end / manual → nutrition cluster finalize (day_complete)
 *   meal_*           → nutrition reconcile / day-aggregate
 *
 * Facts, rules, and alarms (non-LLM) are written by the chokidar live tick
 * (`runDaily(..., { liveOnly: true })` in dispatcher.ts), independent of these
 * handlers — so removing the legacy LLM stages here does not affect them.
 *
 * Bus serialises per periodKey, so multiple events on the same date queue
 * behind one another and the GPU stays single-tenant.
 */

import { log } from "../logger.ts";
import { runV3Cluster, type V3Cluster } from "../v3-orchestrator.ts";
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

function parseIso(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

async function onSleepComplete(ev: PulseEvent): Promise<void> {
  log.info("sub", `sleep_complete wake=${ev.payload.wake_iso ?? "?"} → notify`);
  // The sleep / recovery / morning insights are now produced by the v4
  // view-state pipeline. This handler only fires the PWA push. Duration is
  // derived from the bedtime/wake stamps in the bus payload.
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

async function onWorkoutComplete(ev: PulseEvent): Promise<void> {
  log.info(
    "sub",
    `workout_complete duration=${ev.payload.duration_min ?? "?"}min → training`,
  );
  // Training cluster STAYS: training/page.tsx still reads training_insight.json.
  // (Wearable activity KPIs now come from the v4 view-state pipeline.) The
  // packager picks up the just-finished ActualSession via PULSE_ACTUAL_SESSION.
  await runCluster("training", ev.periodKey);
  // Notify once the cluster settles. dedupe keyed on the workout end stamp so
  // two workouts on the same day each get their own ping.
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
  // Daily prose (v2) + v3 synthesis/cluster insights moved to the v4
  // view-state pipeline. The day_end hook now only finalizes the nutrition
  // insight (day_complete=true marks Stage C complete). Facts/rules/alarms are
  // written by the chokidar live tick, not here.
  log.info("sub", `day_end → nutrition finalize ${ev.periodKey}`);
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
}

function onManual(ev: PulseEvent): Promise<void> {
  log.info("sub", "manual trigger");
  return onDayEnd(ev);
}

// ── Nutrition events ─────────────────────────────────────────────────────────
//
// `meal_logged_pending` is a wake-up hint for the reconciler — the reconciler
// also drains pulse.db on a short tick regardless, so this is a latency
// optimisation, not the queue.
//
// `meal_classified` / `meal_edited` run the day-level multi-image aggregator
// (debounced via the bus's per-periodKey queue) so the dashboard's nutrition
// view stays fresh without spamming the GPU.

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
