/** Per-metric labels + colour mapping shared across all dynamic chart kinds. */

const COLORS: Record<string, string> = {
  sleep_score: "var(--color-sleep)",
  tst: "var(--color-sleep)",
  deep: "var(--color-sleep-2)",
  rem: "var(--color-sleep-2)",
  rhr: "var(--color-heart)",
  hrv: "var(--color-heart)",
  hr: "var(--color-heart)",
  steps: "var(--color-activity)",
  active_minutes: "var(--color-activity)",
  stress: "var(--color-stress)",
  weight: "var(--color-temp)",
  spo2: "var(--color-temp)",
  temp_skin: "var(--color-temp)",
  training_load: "var(--color-activity)",
  acwr: "var(--color-stress)",
};

const LABELS: Record<string, string> = {
  sleep_score: "Schlafqualität",
  tst: "Schlafdauer",
  deep: "Tiefschlaf",
  rem: "REM",
  rhr: "Ruhepuls",
  hrv: "HRV",
  hr: "Puls",
  steps: "Schritte",
  active_minutes: "Aktive Min.",
  stress: "Stress",
  weight: "Gewicht",
  spo2: "SpO₂",
  temp_skin: "Hauttemp.",
  training_load: "Trainingslast",
  acwr: "ACWR",
};

const UNITS: Record<string, string> = {
  sleep_score: "%",
  tst: "min",
  deep: "min",
  rem: "min",
  rhr: "bpm",
  hrv: "ms",
  hr: "bpm",
  steps: "",
  active_minutes: "min",
  stress: "",
  weight: "kg",
  spo2: "%",
  temp_skin: "°C",
  training_load: "",
  acwr: "",
};

// Metrics whose raw value is in minutes — formatted as h:mm so users don't read
// "455 min" and have to do arithmetic. Display unit collapses into the value.
const DURATION_METRICS = new Set(["tst", "deep", "rem", "active_minutes"]);

export function isDurationMetric(m: string): boolean {
  return DURATION_METRICS.has(m);
}

export function metricColor(m: string): string {
  return COLORS[m] ?? "var(--color-sleep)";
}
export function metricLabel(m: string): string {
  return LABELS[m] ?? m;
}
export function metricUnit(m: string): string {
  return UNITS[m] ?? "";
}

/** Display-time unit. Duration metrics fold their unit into the value, so
 * legends/labels should not duplicate it. */
export function metricUnitDisplay(m: string): string {
  if (isDurationMetric(m)) return "";
  return metricUnit(m);
}

/** Human-friendly value formatter. Duration metrics render as `7h 30m` (or
 * `7h` in compact axis-tick mode). Steps/loads round; everything else 1dp. */
export function formatMetricValue(
  metric: string,
  value: number | null | undefined,
  opts: { compact?: boolean } = {},
): string {
  if (value == null || typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (isDurationMetric(metric)) {
    if (value < 60) return `${Math.round(value)}m`;
    const h = Math.floor(value / 60);
    const m = Math.round(value % 60);
    if (m === 0) return `${h}h`;
    if (opts.compact) return `${h}:${String(m).padStart(2, "0")}`;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  if (metric === "steps" || metric === "training_load") {
    return Math.round(value).toLocaleString("de-DE");
  }
  if (Math.abs(value) >= 100) return Math.round(value).toString();
  return value.toFixed(1);
}
