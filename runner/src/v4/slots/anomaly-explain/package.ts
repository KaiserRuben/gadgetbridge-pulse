/**
 * Anomaly-explain packager.
 *
 * User-triggered. The UI passes an observation_id; the worker resolves it
 * to the underlying AnomalyEvent (from tier1.context.anomalies_today) and
 * also pulls neighbor metric history for the affected metric.
 */

import { shortHash, type SlotBuildContext, type SlotPackage } from "../_shared.ts";
import type { AnomalyEvent, Point } from "../../types.ts";

export interface AnomalyExplainEventRef {
  event_id: string;        // observation_id, e.g. obs_rhr_up_2026_05_27
  observation_id: string;
}

export interface AnomalyExplainDomain {
  anomaly: AnomalyEvent;
  /** Same metric values for the surrounding 14-day window (from tier1.kpis_14d if available). */
  metric_history_14d: Point[];
  /** Up to 8 fields from tier1.facts_now / tier1.kpis_today that may bear on this anomaly. */
  cross_signals: Record<string, number | string | boolean | null>;
}

export type AnomalyExplainPackage = SlotPackage<AnomalyExplainDomain>;

export interface BuildAnomalyExplainOpts {
  ctx: SlotBuildContext;
  event: AnomalyExplainEventRef;
}

export async function buildAnomalyExplainPackage(
  opts: BuildAnomalyExplainOpts,
): Promise<AnomalyExplainPackage> {
  const { ctx, event } = opts;
  const anomaly = resolveAnomaly(ctx, event.observation_id);
  const history = pickMetricHistory(ctx, anomaly?.metric ?? null);
  const cross = buildCrossSignals(ctx);

  return {
    meta: {
      period_key: ctx.period_key,
      generated_at: ctx.now.toISOString(),
      tz: ctx.tz,
      package_version: "anomaly-explain-package/v1",
    },
    tier1_snapshot: ctx.tier1,
    prior: {},
    domain: {
      anomaly: anomaly ?? emptyAnomaly(event.observation_id),
      metric_history_14d: history,
      cross_signals: cross,
    },
  };
}

export function anomalyExplainFactsHash(pkg: AnomalyExplainPackage): string {
  return shortHash({
    period_key: pkg.meta.period_key,
    code: pkg.domain.anomaly.code,
    value: pkg.domain.anomaly.value,
  });
}

function resolveAnomaly(ctx: SlotBuildContext, observationId: string): AnomalyEvent | null {
  const list = ctx.tier1.context.anomalies_today;
  return list.find((a) => a.code === observationId) ?? null;
}

function emptyAnomaly(observationId: string): AnomalyEvent {
  return {
    code: observationId,
    severity: "info",
    headline_de: "Unbekannte Beobachtung",
    message_de: "Diese Beobachtung wurde nicht in tier1 gefunden.",
    metric: "unknown",
    value: null,
  };
}

function pickMetricHistory(ctx: SlotBuildContext, metric: string | null): Point[] {
  if (!metric) return [];
  const k = ctx.tier1.kpis_14d as unknown as Record<string, Point[]>;
  // Conventional mapping: anomaly.metric → kpis_14d series key
  if (metric.startsWith("sleep")) return k.sleep_quality_series ?? [];
  if (metric === "rmssd_ms" || metric === "rhr") return k.autonomic_balance_series ?? [];
  if (metric === "volume_load" || metric === "workout_load") return k.volume_load_series ?? [];
  if (metric === "day_score") return k.day_score_series ?? [];
  return [];
}

function buildCrossSignals(
  ctx: SlotBuildContext,
): Record<string, number | string | boolean | null> {
  const k = ctx.tier1.kpis_today;
  return {
    tst_min: k.tst_min,
    sleep_eff_pct: k.sleep_eff_pct,
    rmssd_ms: k.rmssd_ms,
    rhr_sleep_bpm: k.rhr_sleep_bpm,
    rhr_day_bpm: k.rhr_day_bpm,
    steps: k.steps,
    active_kcal: k.active_kcal,
    stress_mean: k.stress_mean,
  };
}
