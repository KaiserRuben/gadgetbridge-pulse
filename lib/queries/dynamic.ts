/**
 * Server-side data fetcher for dynamic chart specs. Resolves a
 * `DynamicChartSpec` (LLM- or chip-emitted) into a per-day series suitable
 * for any of the six chart components. All values keyed by YYYY-MM-DD; the
 * client never sees the raw SQL rows.
 *
 * Strategy: for each metric, walk the date range and read the matching
 * `_facts.json` (cheap — already on disk). Falls back to live SQL when a
 * fact file is missing for the current day.
 */

import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unstable_noStore as noStore } from "next/cache";

import { addDays, isoWeekStart, todayKey, windowForDate } from "@/lib/time";
import {
  getActivityMinutes,
  getDaySummary,
  getHrSeries,
  getSpo2Series,
} from "@/lib/queries/activity";
import { getStress, getHrv, getTemperature } from "@/lib/queries/biometrics";
import { getTrainingLoadAcute, getAcwrSnapshot } from "@/lib/queries/workouts";
import {
  type DynamicChartSpec,
  type Metric,
  type Span,
} from "@/lib/chart-spec";
import type { FactsBundleV2 } from "@/lib/types/generated";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

export type DateValue = { date: string; value: number | null };

export type DynamicChartData = {
  spec: DynamicChartSpec;
  /** Resolved span — what dates the chart actually covers. */
  range: { start: string; end: string };
  /** Per-metric series, in the order spec.metrics were given. */
  series: Array<{ metric: Metric; points: DateValue[] }>;
  /** Filled when comparison.kind !== "none". Same shape as `series`. */
  comparison?: Array<{ metric: Metric; points: DateValue[] }>;
  /** Optional aggregate baseline value (vs_baseline_*). Per-metric, single number. */
  baseline?: Record<string, number | null>;
};

export async function fetchDynamicChartData(
  spec: DynamicChartSpec,
  todayOverride?: string,
): Promise<DynamicChartData> {
  noStore();
  const today = todayOverride ?? todayKey();
  const range = resolveSpan(spec.span, today);

  const dates = enumerate(range.start, range.end);
  const series = await Promise.all(
    spec.metrics.map(async (metric) => ({
      metric,
      points: await readMetricSeries(metric, dates, spec.filter),
    })),
  );

  let comparison: DynamicChartData["comparison"];
  let baseline: DynamicChartData["baseline"];

  if (spec.comparison.kind === "vs_prior_period") {
    const cmpRange = priorPeriod(range);
    const cmpDates = enumerate(cmpRange.start, cmpRange.end);
    comparison = await Promise.all(
      spec.metrics.map(async (metric) => ({
        metric,
        points: await readMetricSeries(metric, cmpDates, spec.filter),
      })),
    );
  } else if (
    spec.comparison.kind === "vs_baseline_14d" ||
    spec.comparison.kind === "vs_baseline_30d"
  ) {
    const n = spec.comparison.kind === "vs_baseline_14d" ? 14 : 30;
    const cmpEnd = addDays(range.start, -1);
    const cmpStart = addDays(cmpEnd, -(n - 1));
    const cmpDates = enumerate(cmpStart, cmpEnd);
    baseline = {};
    for (const metric of spec.metrics) {
      const points = await readMetricSeries(metric, cmpDates, spec.filter);
      baseline[metric] = mean(points.map((p) => p.value).filter(notNull));
    }
  } else if (spec.comparison.kind === "vs_same_dow") {
    // For each date in range, average the same-DoW from the prior 4 weeks.
    baseline = {};
    for (const metric of spec.metrics) {
      const refs: number[] = [];
      for (const d of dates) {
        for (let w = 1; w <= 4; w++) {
          const ref = addDays(d, -7 * w);
          const v = await readMetricForDate(metric, ref, spec.filter);
          if (v != null) refs.push(v);
        }
      }
      baseline[metric] = mean(refs);
    }
  }

  return { spec, range, series, comparison, baseline };
}

// ── span resolution ─────────────────────────────────────────────────────────

function resolveSpan(span: Span, today: string): { start: string; end: string } {
  if (span.kind === "last_n_days") {
    const end = today;
    const start = addDays(end, -(span.n - 1));
    return { start, end };
  }
  if (span.kind === "current_iso_week") {
    const start = isoWeekStart(today);
    const end = addDays(start, 6);
    return { start, end };
  }
  if (span.kind === "prior_iso_week") {
    const thisStart = isoWeekStart(today);
    const start = addDays(thisStart, -7);
    const end = addDays(start, 6);
    return { start, end };
  }
  if (span.kind === "current_iso_month") {
    const start = today.slice(0, 7) + "-01";
    const [y, m] = start.split("-").map(Number);
    const end = lastDayOfMonth(y, m);
    return { start, end };
  }
  // prior_iso_month
  const [yt, mt] = today.split("-").map(Number);
  const py = mt === 1 ? yt - 1 : yt;
  const pm = mt === 1 ? 12 : mt - 1;
  const start = `${py}-${String(pm).padStart(2, "0")}-01`;
  return { start, end: lastDayOfMonth(py, pm) };
}

function priorPeriod(range: { start: string; end: string }): { start: string; end: string } {
  const len = enumerate(range.start, range.end).length;
  const cmpEnd = addDays(range.start, -1);
  const cmpStart = addDays(cmpEnd, -(len - 1));
  return { start: cmpStart, end: cmpEnd };
}

function enumerate(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function lastDayOfMonth(y: number, m: number): string {
  const dt = new Date(Date.UTC(y, m, 0));
  return `${y}-${String(m).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// ── per-metric extractors ───────────────────────────────────────────────────

async function readMetricSeries(
  metric: Metric,
  dates: string[],
  filter: DynamicChartSpec["filter"],
): Promise<DateValue[]> {
  const out: DateValue[] = [];
  for (const d of dates) {
    const v = await readMetricForDate(metric, d, filter);
    out.push({ date: d, value: v });
  }
  return applyFilter(out, filter);
}

async function readMetricForDate(
  metric: Metric,
  date: string,
  filter: DynamicChartSpec["filter"],
): Promise<number | null> {
  // 1) Try the cached _facts.json the runner writes per day. Fast (already
  // disk-cached), avoids re-running SQL aggregation.
  const facts = await loadFacts(date);
  const fromFacts = factValue(metric, facts);
  if (fromFacts != null) {
    if (filter?.min_sleep_min) {
      const tst = facts?.sleep?.metrics?.tst_min;
      if (typeof tst === "number" && tst < filter.min_sleep_min) return null;
    }
    return fromFacts;
  }
  // 2) Fall back to live SQL — used for metrics not stored in facts (HR
  // distribution, sub-day samples) and for the current day before the
  // watch container has written any facts.
  return liveValue(metric, date);
}

async function loadFacts(date: string): Promise<FactsBundleV2 | null> {
  const p = path.join(INSIGHTS_ROOT, "daily", date, "_facts.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
}

function factValue(metric: Metric, f: FactsBundleV2 | null): number | null {
  if (!f) return null;
  switch (metric) {
    case "sleep_score":
      return numeric(f.sleep?.metrics?.sleep_efficiency_pct);
    case "tst":
      return numeric(f.sleep?.metrics?.tst_min);
    case "deep":
      return numeric((f.sleep?.metrics as Record<string, unknown> | undefined)?.deep_min);
    case "rem":
      return numeric((f.sleep?.metrics as Record<string, unknown> | undefined)?.rem_min);
    case "rhr":
      return numeric(f.cardio?.metrics?.rhr_day_bpm);
    case "hrv":
      return numeric((f.cardio?.metrics as Record<string, unknown> | undefined)?.hrv_overnight_ms);
    case "hr":
      return numeric((f.cardio?.metrics as Record<string, unknown> | undefined)?.hr_day_avg_bpm);
    case "steps":
      return numeric(f.activity?.metrics?.steps);
    case "active_minutes":
      return numeric(f.activity?.metrics?.active_minutes);
    case "stress":
      return numeric((f.stress?.metrics as Record<string, unknown> | undefined)?.stress_day_avg);
    case "weight":
      return numeric(f.body?.metrics?.weight_kg);
    case "spo2":
      return numeric((f.body?.metrics as Record<string, unknown> | undefined)?.spo2_day_avg_pct);
    case "temp_skin":
      return numeric((f.body?.metrics as Record<string, unknown> | undefined)?.skin_temp_avg_c);
    case "training_load":
    case "acwr":
      return null; // SQL-only
    default:
      return null;
  }
}

function liveValue(metric: Metric, date: string): number | null {
  const w = windowForDate(date);
  try {
    switch (metric) {
      case "steps":
      case "active_minutes": {
        const summary = getDaySummary({ since: w.since, until: w.until });
        if (metric === "steps") return summary.totalSteps;
        // No `activeMinutes` in DaySummary — sum the per-minute rows above 0 steps
        const mins = getActivityMinutes({ since: w.since, until: w.until });
        return mins.filter((m) => m.steps > 0).length;
      }
      case "rhr": {
        const mins = getActivityMinutes({ since: w.since, until: w.until });
        const hrs = mins.map((m) => m.hr).filter((v) => v > 30 && v < 220);
        if (!hrs.length) return null;
        return median(hrs);
      }
      case "hr": {
        const series = getHrSeries({ since: w.since, until: w.until });
        if (!series.length) return null;
        return mean(series.map((s) => s.hr));
      }
      case "spo2": {
        const series = getSpo2Series({ since: w.since, until: w.until });
        if (!series.length) return null;
        return mean(series.map((s) => s.spo2));
      }
      case "stress": {
        const series = getStress({ since: w.since, until: w.until });
        if (!series.length) return null;
        return mean(series.map((s) => s.stress));
      }
      case "hrv": {
        const series = getHrv({ since: w.since, until: w.until });
        if (!series.length) return null;
        return mean(series.map((s) => s.ms));
      }
      case "temp_skin": {
        const series = getTemperature({ since: w.since, until: w.until });
        if (!series.length) return null;
        return mean(series.map((s) => s.celsius));
      }
      case "training_load": {
        const series = getTrainingLoadAcute({ sinceSec: w.since, untilSec: w.until });
        if (!series.length) return null;
        return series[series.length - 1]?.value ?? null;
      }
      case "acwr": {
        const snap = getAcwrSnapshot();
        return snap?.ratio ?? null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function applyFilter(rows: DateValue[], filter: DynamicChartSpec["filter"]): DateValue[] {
  if (!filter) return rows;
  let out = rows;
  if (filter.weekday_only) {
    out = out.map((r) => {
      const dow = dowOf(r.date);
      return dow >= 1 && dow <= 5 ? r : { ...r, value: null };
    });
  }
  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function numeric(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function notNull<T>(v: T | null): v is T {
  return v != null;
}
function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function dowOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}
