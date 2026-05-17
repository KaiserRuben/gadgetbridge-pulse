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
import { bus, type PulseEvent } from "./bus.ts";

async function runCluster(cluster: V3Cluster, periodKey: string): Promise<void> {
  try {
    const r = await runV3Cluster(cluster, { periodKey });
    if (r.ok) {
      log.info("sub", `${cluster} ok ${r.totalMs}ms${r.skipped ? " (reused)" : ""}`);
    } else {
      log.error("sub", `${cluster} fail ${r.totalMs}ms — ${r.errors.join("|") || "?"}`);
    }
  } catch (err) {
    log.error("sub", `${cluster} crashed: ${(err as Error).message}`);
  }
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
  if (!v2Done) {
    const v2 = await runDaily(ev.periodKey, {});
    if (!v2.ok) {
      log.error("sub", `v2 failed: ${v2.error}`);
    } else {
      log.info(
        "sub",
        `v2 done pipeline=${v2.bundle.pipeline_status} verify=${v2.verify.ok ? "ok" : "fail"}`,
      );
    }
  }
  if (!v3Done) {
    try {
      const v3 = await runV3({ periodKey: ev.periodKey });
      if (v3.ok) {
        log.info("sub", `v3 done ${v3.totalMs}ms`);
      } else {
        log.error("sub", `v3 fail ${v3.totalMs}ms — ${v3.errors.join("|") || "?"}`);
      }
    } catch (err) {
      log.error("sub", `v3 crashed: ${(err as Error).message}`);
    }
  }

  // Nutrition cluster runs after v3 — day_complete=true means Stage C marks
  // the insight `complete`. Standalone of v3 (doesn't share its completion
  // log) so a missing classified meal photo doesn't block the rest of v3.
  try {
    const n = await runNutritionCluster({ periodKey: ev.periodKey, day_complete: true });
    if (!n.ok) log.warn("sub", `nutrition cluster fail: ${n.error}`);
  } catch (err) {
    log.error("sub", `nutrition cluster crashed: ${(err as Error).message}`);
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
  const r = await runNutritionCluster({ periodKey: ev.periodKey });
  if (!r.ok) log.warn("sub", `nutrition cluster fail: ${r.error}`);
}

export function registerSubscribers(): void {
  bus.on("day_end", onDayEnd);
  bus.on("sleep_complete", onSleepComplete);
  bus.on("workout_complete", onWorkoutComplete);
  bus.on("manual", onManual);
  bus.on("meal_logged_pending", onMealLoggedPending);
  bus.on("meal_classified", onMealClassifiedOrEdited);
  bus.on("meal_edited", onMealClassifiedOrEdited);
}
