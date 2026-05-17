/**
 * Lever computation — pure deterministic math, no LLM.
 *
 * Per the analyzer/README.md principle: compute every numeric value
 * (mean, stddev, slope, projection) here, before any LLM call. The LLM
 * only writes a narrow framing for one lever per call.
 *
 * Four levers:
 *   - sleep_midpoint_stability  (sleep)   — bedtime + tst/2 minutes-from-midnight
 *   - sedentary_blocks          (activity) — days with sedentary_minutes > 1200
 *   - steps_daily               (activity) — 7d mean vs trailing 7d
 *   - rhr_drift                 (heart)    — 14-day linear regression on rhr_day_bpm
 *
 * Source data: `${insightsRoot}/daily/<YYYY-MM-DD>/_facts.json`. Reads
 * up to the prior 14 days (today included). Skips missing files
 * gracefully. Skips a lever if `n_days_used < 7`.
 *
 * Bedtime field is not in `_facts.json` today; the sleep-midpoint
 * lever falls back to using `sleep_latency_min` and `tst_min` only when
 * a `bedtime_local` field appears. With current data shape this lever
 * will always skip — kept for forward compatibility.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FactsBundleV2 } from "@/lib/types/generated";

export type LeverId =
  | "sleep_midpoint_stability"
  | "sedentary_blocks"
  | "steps_daily"
  | "rhr_drift";

export type LeverDomain = "sleep" | "activity" | "heart";

export type LeverConfidence = "high" | "medium" | "low";

export interface LeverSnapshot {
  lever: LeverId;
  /** Human-readable for prompt only, e.g. "7h 12m" or "8.4k Schritte". */
  current_value: string;
  /** Raw numeric for trend math (or null). */
  current_value_num: number | null;
  baseline_mean: number | null;
  /**
   * Pre-formatted baseline summary for the LLM prompt, e.g. "14-Tage-Schnitt
   * 07:18" for sleep midpoint, "1058 min" for sedentary, "7.2k Schritte/Tag"
   * for steps, "64.8 bpm" for RHR. Required because the raw `baseline_mean`
   * is unit-less and meaningless to the model for time-of-day metrics.
   */
  baseline_display: string;
  baseline_std: number | null;
  trend_direction: "up" | "down" | "flat";
  projected_90d_value: number | null;
  /** Pre-formatted projection text, e.g. "ca. 86.6 bpm". */
  projection_text: string;
  n_days_used: number;
  confidence: LeverConfidence;
  domain: LeverDomain;
}

interface FactsWithDate {
  date: string;
  facts: FactsBundleV2;
}

const DAYS_WINDOW = 14;
const SEDENTARY_HIGH_MIN = 1200;
const FLAT_THRESHOLD_PCT = 0.10;

/** Subtract `n` days from a YYYY-MM-DD date (UTC math, calendar-correct). */
function shiftDate(periodKey: string, daysBack: number): string {
  const [y, m, d] = periodKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function readFactsForDate(date: string, factsDir: string): Promise<FactsBundleV2 | null> {
  const filePath = path.join(factsDir, "daily", date, "_facts.json");
  try {
    const txt = await readFile(filePath, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
}

/** Load today + prior 13 days (calendar). Missing files are skipped. */
async function loadWindow(latestDate: string, factsDir: string): Promise<FactsWithDate[]> {
  const out: FactsWithDate[] = [];
  for (let i = 0; i < DAYS_WINDOW; i++) {
    const d = shiftDate(latestDate, i);
    const facts = await readFactsForDate(d, factsDir);
    if (facts) out.push({ date: d, facts });
  }
  // Sort ascending so regressions index 0..n by chronology.
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Linear regression: returns slope (units per index step) and intercept. */
function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumX2 - n * meanX * meanX;
  if (denom === 0) return { slope: 0, intercept: meanY };
  const slope = (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function confidenceFromN(n: number): LeverConfidence {
  if (n >= 10) return "high";
  if (n >= 7) return "medium";
  return "low";
}

function trendFromSlope(slope: number, baseline: number, threshold = FLAT_THRESHOLD_PCT): "up" | "down" | "flat" {
  if (baseline === 0) {
    if (slope > 0) return "up";
    if (slope < 0) return "down";
    return "flat";
  }
  const pct = Math.abs((slope * 7) / baseline);
  if (pct < threshold) return "flat";
  return slope > 0 ? "up" : "down";
}

// ── Per-lever builders ────────────────────────────────────────────────────

interface BedtimeFacts {
  bedtime_min?: number | null; // minutes from local midnight (Europe/Berlin), 0..1439
}

function bedtimeMinutes(facts: FactsBundleV2): number | null {
  const sleep = facts.sleep;
  if (!sleep) return null;
  const tst = sleep.metrics.tst_min;
  if (tst === null || tst === undefined) return null;
  const ext = sleep.metrics as unknown as BedtimeFacts;
  if (ext.bedtime_min === null || ext.bedtime_min === undefined) return null;
  const bedMin = ext.bedtime_min;
  // Sleep midpoint = bedtime + tst/2, normalised to minutes-from-midnight
  // wrapping in (-12h, +12h) — i.e. bedtime 23:42 with tst 420 → midpoint
  // 23:42 + 03:30 = 03:12 next day = 192 min from midnight.
  const midpoint = (bedMin + tst / 2) % 1440;
  // Map the wall-clock midpoint into a continuous "minutes after 18:00" axis
  // so 02:00 (118 min from midnight) sits next to 23:00 (1380 min), not far
  // away. Anchor at 1080 (= 18:00) so all reasonable midpoints are positive.
  const anchored = (midpoint - 1080 + 1440) % 1440;
  return anchored;
}

function fmtMinutesAsClock(minutesFromAnchor: number): string {
  // Inverse of bedtimeMinutes anchor: anchor was 18:00 → 0.
  // Round first to a whole-minute total; otherwise we can produce "05:60"
  // when both halves round up independently (Math.floor + Math.round bug).
  const total = Math.round(minutesFromAnchor + 1080) % 1440;
  const wallMin = total < 0 ? total + 1440 : total;
  const hh = Math.floor(wallMin / 60);
  const mm = wallMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function buildSleepMidpointLever(window: FactsWithDate[]): LeverSnapshot | null {
  const values: number[] = [];
  let todayValue: number | null = null;
  for (let i = 0; i < window.length; i++) {
    const v = bedtimeMinutes(window[i].facts);
    if (v !== null && Number.isFinite(v)) {
      values.push(v);
      if (i === window.length - 1) todayValue = v;
    }
  }
  if (values.length < 4) return null;

  const m = mean(values);
  const sd = stddev(values);
  const { slope } = linearRegression(values);
  // 90-day extrapolation in same anchored-minutes space.
  const projected = (todayValue ?? m) + 90 * slope;
  const trend = trendFromSlope(slope, Math.max(m, 1));
  const projectionClock = fmtMinutesAsClock(projected);
  const todayClock = todayValue !== null ? fmtMinutesAsClock(todayValue) : "—";
  const driftMin = Math.round(90 * slope);

  return {
    lever: "sleep_midpoint_stability",
    current_value: `Schlafmitte ${todayClock}`,
    current_value_num: todayValue,
    baseline_mean: m,
    baseline_display: `Ø ${fmtMinutesAsClock(m)} (Schlafmitte)`,
    baseline_std: sd,
    trend_direction: trend,
    projected_90d_value: projected,
    projection_text:
      driftMin === 0
        ? `stabil bei ca. ${projectionClock}`
        : `verschiebt sich um ${driftMin >= 0 ? "+" : ""}${driftMin} min auf ca. ${projectionClock}`,
    n_days_used: values.length,
    confidence: confidenceFromN(values.length),
    domain: "sleep",
  };
}

function hasWear(facts: FactsBundleV2): boolean {
  // Treat null wear as "no data captured"; 0 is also unrealistic for a lived day.
  const w = facts.device?.wear_seconds_24h;
  return typeof w === "number" && Number.isFinite(w) && w > 0;
}

function buildSedentaryLever(window: FactsWithDate[]): LeverSnapshot | null {
  const values: number[] = [];
  let todayValue: number | null = null;
  for (let i = 0; i < window.length; i++) {
    if (!hasWear(window[i].facts)) continue;
    const v = window[i].facts.activity?.metrics.sedentary_minutes;
    if (typeof v === "number" && Number.isFinite(v)) {
      values.push(v);
      if (i === window.length - 1) todayValue = v;
    }
  }
  if (values.length < 4) return null;

  const m = mean(values);
  const sd = stddev(values);
  const { slope } = linearRegression(values);
  const projected = (todayValue ?? m) + 90 * slope;
  const trend = trendFromSlope(slope, Math.max(m, 1));

  const highDays = values.filter((v) => v > SEDENTARY_HIGH_MIN).length;
  // Project share of high-sedentary days proportionally over 90 days.
  const projectedHighDays = Math.round((highDays / values.length) * 90);

  const todayDisplay = todayValue !== null
    ? `${todayValue} min am ${window[window.length - 1].date}; ${highDays} von ${values.length} Tagen >${SEDENTARY_HIGH_MIN} min`
    : `${highDays} von ${values.length} Tagen >${SEDENTARY_HIGH_MIN} min`;

  return {
    lever: "sedentary_blocks",
    current_value: todayDisplay,
    current_value_num: todayValue,
    baseline_mean: m,
    baseline_display: `Ø ${Math.round(m)} min Sitzzeit/Tag`,
    baseline_std: sd,
    trend_direction: trend,
    projected_90d_value: projected,
    projection_text: `~${projectedHighDays} von 90 Tagen mit hoher Sitzzeit`,
    n_days_used: values.length,
    confidence: confidenceFromN(values.length),
    domain: "activity",
  };
}

function buildStepsLever(window: FactsWithDate[]): LeverSnapshot | null {
  const series: number[] = [];
  let todayValue: number | null = null;
  for (let i = 0; i < window.length; i++) {
    if (!hasWear(window[i].facts)) continue;
    const v = window[i].facts.activity?.metrics.steps;
    if (typeof v === "number" && Number.isFinite(v)) {
      series.push(v);
      if (i === window.length - 1) todayValue = v;
    }
  }
  if (series.length < 4) return null;

  // 7-day mean vs prior 7-day mean if we have 14, else fall back to all-vs-trailing.
  const last7 = series.slice(-7);
  const prior = series.length >= 14 ? series.slice(-14, -7) : series.slice(0, Math.max(1, series.length - 7));
  const last7Mean = mean(last7);
  const priorMean = prior.length > 0 ? mean(prior) : last7Mean;
  const trailing7Mean = series.length > 1
    ? mean(series.slice(0, -1).slice(-7))
    : last7Mean;

  // Trend: 10% threshold last7 vs prior.
  let trend: "up" | "down" | "flat" = "flat";
  if (priorMean > 0) {
    const pct = (last7Mean - priorMean) / priorMean;
    if (pct >= FLAT_THRESHOLD_PCT) trend = "up";
    else if (pct <= -FLAT_THRESHOLD_PCT) trend = "down";
  } else if (last7Mean > 0) {
    trend = "up";
  }

  const todayNum = todayValue ?? 0;
  // Per spec: today + 90 × (today - baseline_mean) / 7 for 90-day projection
  const baseline = trailing7Mean;
  const projected = todayNum + (90 * (todayNum - baseline)) / 7;
  const fmt = (n: number): string =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;

  return {
    lever: "steps_daily",
    current_value: `${fmt(last7Mean)} Schritte/Tag (7d) vs ${fmt(priorMean)} (Vorwoche)`,
    current_value_num: todayValue,
    baseline_mean: baseline,
    baseline_display: `Ø ${fmt(baseline)} Schritte/Tag (Vorwoche)`,
    baseline_std: stddev(series),
    trend_direction: trend,
    projected_90d_value: projected,
    projection_text:
      trend === "down"
        ? `sinkt auf ca. ${fmt(Math.max(0, projected))} Schritte/Tag`
        : trend === "up"
          ? `steigt auf ca. ${fmt(projected)} Schritte/Tag`
          : `bleibt nahe ${fmt(last7Mean)} Schritte/Tag`,
    n_days_used: series.length,
    confidence: confidenceFromN(series.length),
    domain: "activity",
  };
}

function buildRhrLever(window: FactsWithDate[]): LeverSnapshot | null {
  const values: number[] = [];
  let todayValue: number | null = null;
  for (let i = 0; i < window.length; i++) {
    const v = window[i].facts.cardio?.metrics.rhr_day_bpm;
    if (typeof v === "number" && Number.isFinite(v)) {
      values.push(v);
      if (i === window.length - 1) todayValue = v;
    }
  }
  if (values.length < 4) return null;

  const m = mean(values);
  const sd = stddev(values);
  const { slope } = linearRegression(values);
  const projected = (todayValue ?? m) + 90 * slope;
  const trend = trendFromSlope(slope, Math.max(m, 1));
  const todayStr = todayValue !== null ? todayValue.toFixed(1) : "—";

  return {
    lever: "rhr_drift",
    current_value: `${todayStr} bpm vs 14-Tage-Schnitt ${m.toFixed(1)} bpm`,
    current_value_num: todayValue,
    baseline_mean: m,
    baseline_display: `Ø ${m.toFixed(1)} bpm (Ruhepuls)`,
    baseline_std: sd,
    trend_direction: trend,
    projected_90d_value: projected,
    projection_text:
      trend === "flat"
        ? `bleibt nahe ${m.toFixed(1)} bpm`
        : `${trend === "up" ? "steigt" : "sinkt"} auf ca. ${projected.toFixed(1)} bpm`,
    n_days_used: values.length,
    confidence: confidenceFromN(values.length),
    domain: "heart",
  };
}

/**
 * Compute all viable lever snapshots for `latestDate`. Reads up to 14 days
 * of `_facts.json` from `${factsDir}/daily/<YYYY-MM-DD>/_facts.json`. Returns
 * only levers with `n_days_used >= 7`.
 */
export async function computeLevers(latestDate: string, factsDir: string): Promise<LeverSnapshot[]> {
  const window = await loadWindow(latestDate, factsDir);
  const builders: Array<(w: FactsWithDate[]) => LeverSnapshot | null> = [
    buildSleepMidpointLever,
    buildSedentaryLever,
    buildStepsLever,
    buildRhrLever,
  ];
  const out: LeverSnapshot[] = [];
  for (const b of builders) {
    const snap = b(window);
    if (snap) out.push(snap);
  }
  return out;
}
