/**
 * Dynamic chart spec — the shape an LLM emits, and the dashboard renders.
 *
 * Closed-enum design (see Rize backend `extract_best_chart`): the LLM never
 * invents a chart_type or metric name; it picks from this short fixed menu.
 *
 * The LLM is intentionally NOT asked to compute or emit dates. It picks a
 * relative span (`last_n_days`, `current_iso_week`, `current_iso_month`,
 * `prior_iso_week`, `prior_iso_month`) plus an integer where applicable; we
 * resolve concrete unix-second windows server-side from the user's "today".
 */

export const CHART_TYPES = [
  "trend",
  "comparison",
  "distribution",
  "calendar",
  "scatter",
  "stacked",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const METRICS = [
  "sleep_score",
  "tst",
  "deep",
  "rem",
  "rhr",
  "hrv",
  "hr",
  "steps",
  "active_minutes",
  "stress",
  "weight",
  "spo2",
  "temp_skin",
  "training_load",
  "acwr",
] as const;
export type Metric = (typeof METRICS)[number];

export type Span =
  | { kind: "last_n_days"; n: number }
  | { kind: "current_iso_week" }
  | { kind: "prior_iso_week" }
  | { kind: "current_iso_month" }
  | { kind: "prior_iso_month" };

export type Comparison =
  | { kind: "none" }
  | { kind: "vs_prior_period" }
  | { kind: "vs_baseline_14d" }
  | { kind: "vs_baseline_30d" }
  | { kind: "vs_same_dow" };

export type Filter = {
  workout_only?: boolean;
  weekday_only?: boolean;
  band?: "good" | "mixed" | "bad";
  min_sleep_min?: number;
};

export type DynamicChartSpec = {
  chart_type: ChartType;
  metrics: Metric[];
  span: Span;
  comparison: Comparison;
  filter?: Filter;
  reasoning: string;
};

// ── synonym normalisation ───────────────────────────────────────────────────

/**
 * Map a raw metric string (LLM output, user input, snake_case, camelCase, EN
 * or DE) to one of the closed `METRICS` enum values. Returns null if no
 * known mapping applies. Small models occasionally invent metrics like
 * `stress_level` or `heart_rate` — this absorbs the most common drift
 * without enlarging the enum itself.
 */
const SYNONYMS: Record<string, Metric> = {
  // canonical → canonical (ensures exact matches still work)
  ...Object.fromEntries(METRICS.map((m) => [m, m])),
  // common drift
  sleep_quality: "sleep_score",
  sleep: "sleep_score",
  schlaf: "sleep_score",
  schlafqualitat: "sleep_score",
  schlafqualität: "sleep_score",
  total_sleep_time: "tst",
  schlafdauer: "tst",
  deep_sleep: "deep",
  tiefschlaf: "deep",
  rem_sleep: "rem",
  resting_heart_rate: "rhr",
  resting_hr: "rhr",
  ruhepuls: "rhr",
  heart_rate: "hr",
  herzfrequenz: "hr",
  hrv_overnight: "hrv",
  hrv_ms: "hrv",
  schritte: "steps",
  step_count: "steps",
  active_min: "active_minutes",
  aktive_minuten: "active_minutes",
  stress_level: "stress",
  stress_score: "stress",
  body_weight: "weight",
  gewicht: "weight",
  blood_oxygen: "spo2",
  oxygen_saturation: "spo2",
  skin_temperature: "temp_skin",
  hauttemperatur: "temp_skin",
  load: "training_load",
  acute_load: "training_load",
  acute_chronic_workload_ratio: "acwr",
};

export function canonicalMetric(raw: string): Metric | null {
  const k = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");
  return SYNONYMS[k] ?? null;
}

// ── runtime validation ──────────────────────────────────────────────────────

/**
 * Coerce + validate an unknown payload into a DynamicChartSpec. Returns
 * `null` on any structural failure so the caller can fall back to chip-only
 * mode rather than crash.
 */
export function parseChartSpec(raw: unknown): DynamicChartSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // Small models occasionally wrap chart_type in a single-item array. Unwrap.
  let chartTypeIn: unknown = r.chart_type;
  if (Array.isArray(chartTypeIn) && chartTypeIn.length === 1) chartTypeIn = chartTypeIn[0];
  if (
    typeof chartTypeIn !== "string" ||
    !CHART_TYPES.includes(chartTypeIn as ChartType)
  ) {
    return null;
  }
  const chart_type = chartTypeIn as ChartType;
  const metricsIn = Array.isArray(r.metrics) ? r.metrics : [];
  const metrics: Metric[] = [];
  for (const raw of metricsIn) {
    if (typeof raw !== "string") continue;
    const canonical = canonicalMetric(raw);
    if (canonical) metrics.push(canonical);
  }
  if (metrics.length === 0) return null;

  const span = parseSpan(r.span);
  if (!span) return null;

  const comparison = parseComparison(r.comparison);
  const filter = parseFilter(r.filter);
  const reasoning = typeof r.reasoning === "string" ? r.reasoning.slice(0, 240) : "";

  return {
    chart_type,
    metrics: dedupe(metrics).slice(0, 4),
    span,
    comparison,
    filter,
    reasoning,
  };
}

function parseSpan(raw: unknown): Span | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind === "last_n_days") {
    const n = typeof r.n === "number" ? Math.round(r.n) : NaN;
    if (!Number.isFinite(n) || n < 1 || n > 365) return null;
    return { kind: "last_n_days", n };
  }
  if (
    kind === "current_iso_week" ||
    kind === "prior_iso_week" ||
    kind === "current_iso_month" ||
    kind === "prior_iso_month"
  ) {
    return { kind } as Span;
  }
  return null;
}

function parseComparison(raw: unknown): Comparison {
  if (!raw || typeof raw !== "object") return { kind: "none" };
  const k = (raw as Record<string, unknown>).kind;
  if (
    k === "none" ||
    k === "vs_prior_period" ||
    k === "vs_baseline_14d" ||
    k === "vs_baseline_30d" ||
    k === "vs_same_dow"
  ) {
    return { kind: k } as Comparison;
  }
  return { kind: "none" };
}

function parseFilter(raw: unknown): Filter | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: Filter = {};
  if (typeof r.workout_only === "boolean") out.workout_only = r.workout_only;
  if (typeof r.weekday_only === "boolean") out.weekday_only = r.weekday_only;
  if (r.band === "good" || r.band === "mixed" || r.band === "bad") out.band = r.band;
  if (typeof r.min_sleep_min === "number" && r.min_sleep_min > 0) {
    out.min_sleep_min = Math.round(r.min_sleep_min);
  }
  return Object.keys(out).length ? out : undefined;
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

// ── chip presets ────────────────────────────────────────────────────────────

/**
 * Pre-baked specs that work without an LLM call. The chip strip emits these
 * directly into the same render path as the LLM output, so chip-only mode is
 * a graceful fallback when the chart endpoint is unreachable.
 */
export const CHIP_PRESETS: Array<{ id: string; label: string; spec: DynamicChartSpec }> = [
  {
    id: "sleep_30d_trend",
    label: "Schlaf 30T Trend",
    spec: {
      chart_type: "trend",
      metrics: ["sleep_score", "tst"],
      span: { kind: "last_n_days", n: 30 },
      comparison: { kind: "vs_baseline_30d" },
      reasoning: "Schlaf der letzten 30 Tage mit 30-Tage-Baseline.",
    },
  },
  {
    id: "rhr_vs_prior_week",
    label: "RHR vs. Vorwoche",
    spec: {
      chart_type: "comparison",
      metrics: ["rhr"],
      span: { kind: "current_iso_week" },
      comparison: { kind: "vs_prior_period" },
      reasoning: "Ruhepuls dieser Woche gegen letzte Woche.",
    },
  },
  {
    id: "steps_calendar",
    label: "Schritte Heatmap",
    spec: {
      chart_type: "calendar",
      metrics: ["steps"],
      span: { kind: "last_n_days", n: 60 },
      comparison: { kind: "none" },
      reasoning: "Schritt-Heatmap der letzten 60 Tage.",
    },
  },
  {
    id: "stress_distribution",
    label: "Stress-Verteilung",
    spec: {
      chart_type: "distribution",
      metrics: ["stress"],
      span: { kind: "last_n_days", n: 30 },
      comparison: { kind: "none" },
      reasoning: "Stress-Histogramm letzte 30 Tage.",
    },
  },
  {
    id: "sleep_hrv_scatter",
    label: "Schlaf × HRV",
    spec: {
      chart_type: "scatter",
      metrics: ["sleep_score", "hrv"],
      span: { kind: "last_n_days", n: 60 },
      comparison: { kind: "none" },
      reasoning: "Korrelation Schlafqualität gegen HRV.",
    },
  },
  {
    id: "training_load_30d",
    label: "Last + ACWR",
    spec: {
      chart_type: "stacked",
      metrics: ["training_load", "acwr"],
      span: { kind: "last_n_days", n: 30 },
      comparison: { kind: "none" },
      reasoning: "Trainings-Last (akut) gegen ACWR letzte 30 Tage.",
    },
  },
];
