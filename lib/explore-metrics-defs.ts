/**
 * Client-safe Explore metric definitions.
 *
 * Split from `lib/explore-metrics.ts` because:
 *   - the server module imports `server-only` + `node:fs`, which would
 *     poison any client component that needs the same id list (heatmap
 *     switcher pill, KPI tile labels);
 *   - the per-metric `extract` function isn't serialisable across the
 *     RSC → Client boundary, so the snapshot type returned to clients
 *     must omit it.
 *
 * Treat this file as the canonical metric registry. The server-side
 * helper (`getExploreMetrics`, `getExploreMetricYear`) imports both
 * the registry below and a parallel `EXTRACTORS` table to do the
 * `_facts.json` projection on the server.
 */
import type { FactsBundleV2 } from "@/lib/types/generated";

export type ExploreDomain =
  | "sleep"
  | "heart"
  | "stress"
  | "body"
  | "activity";

export type ExploreMetricId =
  | "sleep_duration"
  | "sleep_efficiency"
  | "sleep_latency"
  | "hrv_rmssd"
  | "rhr"
  | "hr_avg"
  | "stress_avg"
  | "spo2_avg"
  | "skin_temp_delta"
  | "steps"
  | "active_minutes"
  | "breath_rate";

/** Plain-data metric description. Safe to ship to client components. */
export type ExploreMetricDef = {
  id: ExploreMetricId;
  label: string;
  unit: string | null;
  decimals: number;
  domain: ExploreDomain;
  /** CSS variable name (`--color-*`) for the domain accent. */
  accentVar: string;
};

export const EXPLORE_METRICS: readonly ExploreMetricDef[] = [
  {
    id: "sleep_duration",
    label: "Schlafdauer",
    unit: "h",
    decimals: 1,
    domain: "sleep",
    accentVar: "var(--color-sleep)",
  },
  {
    id: "sleep_efficiency",
    label: "Schlafeffizienz",
    unit: "%",
    decimals: 0,
    domain: "sleep",
    accentVar: "var(--color-sleep)",
  },
  {
    id: "sleep_latency",
    label: "Einschlaflatenz",
    unit: "min",
    decimals: 0,
    domain: "sleep",
    accentVar: "var(--color-sleep)",
  },
  {
    id: "hrv_rmssd",
    label: "HRV (RMSSD)",
    unit: "ms",
    decimals: 0,
    domain: "sleep",
    accentVar: "var(--color-hrv)",
  },
  {
    id: "rhr",
    label: "Ruhepuls",
    unit: "bpm",
    decimals: 0,
    domain: "heart",
    accentVar: "var(--color-heart)",
  },
  {
    id: "hr_avg",
    label: "HF Mittel",
    unit: "bpm",
    decimals: 0,
    domain: "heart",
    accentVar: "var(--color-heart)",
  },
  {
    id: "stress_avg",
    label: "Stress",
    unit: null,
    decimals: 0,
    domain: "stress",
    accentVar: "var(--color-stress)",
  },
  {
    id: "spo2_avg",
    label: "SpO₂",
    unit: "%",
    decimals: 1,
    domain: "heart",
    accentVar: "var(--color-spo2)",
  },
  {
    id: "skin_temp_delta",
    label: "Hauttemp. Δ",
    unit: "°C",
    decimals: 2,
    domain: "body",
    accentVar: "var(--color-temp)",
  },
  {
    id: "steps",
    label: "Schritte",
    unit: null,
    decimals: 0,
    domain: "activity",
    accentVar: "var(--color-activity)",
  },
  {
    id: "active_minutes",
    label: "Aktive Minuten",
    unit: "min",
    decimals: 0,
    domain: "activity",
    accentVar: "var(--color-activity)",
  },
  {
    id: "breath_rate",
    label: "Atemfrequenz",
    unit: "/min",
    decimals: 1,
    domain: "body",
    accentVar: "var(--color-spo2)",
  },
] as const;

export const EXPLORE_METRIC_IDS: ReadonlySet<ExploreMetricId> = new Set(
  EXPLORE_METRICS.map((m) => m.id),
);

export function findExploreMetric(
  id: string,
): ExploreMetricDef | undefined {
  return EXPLORE_METRICS.find((m) => m.id === id);
}

export function isExploreMetricId(id: string): id is ExploreMetricId {
  return EXPLORE_METRIC_IDS.has(id as ExploreMetricId);
}

/**
 * Server-only extractor table. Imported by `lib/explore-metrics.ts` to
 * project a `_facts.json` payload to a numeric-or-null value per metric.
 * Kept in this file (instead of co-located with the server helper) so the
 * id ↔ extractor mapping stays adjacent to the registry — easier to
 * maintain when a new metric is added.
 *
 * NOTE: do not import `EXTRACTORS` from a client component. The functions
 * are not serialisable across the RSC boundary. Client code only needs
 * `EXPLORE_METRICS` and the validators above.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export const EXTRACTORS: Record<
  ExploreMetricId,
  (facts: FactsBundleV2) => number | null
> = {
  sleep_duration: (f) => {
    const v = num(f.sleep?.metrics.tst_min);
    return v === null ? null : v / 60;
  },
  sleep_efficiency: (f) => num(f.sleep?.metrics.sleep_efficiency_pct),
  sleep_latency: (f) => num(f.sleep?.metrics.sleep_latency_min),
  hrv_rmssd: (f) => num(f.sleep?.metrics.rmssd_ms),
  rhr: (f) => num(f.cardio.metrics.rhr_day_bpm),
  hr_avg: (f) => num(f.cardio.metrics.hr_mean_bpm),
  stress_avg: (f) => num(f.stress.metrics.stress_mean),
  spo2_avg: (f) => num(f.cardio.metrics.spo2_mean_pct),
  skin_temp_delta: (f) => num(f.body.metrics.skin_temp_delta_c),
  steps: (f) => num(f.activity.metrics.steps),
  active_minutes: (f) => num(f.activity.metrics.active_minutes),
  breath_rate: (f) => num(f.sleep?.metrics.breath_rate_mean),
};
