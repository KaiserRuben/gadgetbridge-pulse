/**
 * Night-review packager.
 *
 * Input shape exposed to the LLM:
 *   meta            — period_key, generated_at, tz, package_version
 *   tier1_snapshot  — full tier1 block (KPIs today, 14d series, context)
 *   prior           — empty for this slot (depends_on=[])
 *   domain:
 *     today_summary       — sleep summary (TST, eff, stages, RHR, RMSSD, SpO2, ...)
 *     stages_timeline     — per-segment stage with duration
 *     hr_5min             — 5-min HR buckets across sleep
 *     spo2_5min           — 5-min SpO2 buckets across sleep
 *     last_2_nights       — neighbor nights summary
 *     days_3_to_7         — older neighbors aggregated
 *     baselines_30d       — robust median+MAD baselines
 *     deltas_today        — today vs baseline (delta_abs, delta_pct, z, band)
 *     workout_context     — yesterday's workouts (load → tonight's sleep)
 *     stress_context      — yesterday's stress block
 *     data_quality        — wear hours, missing nights, signal issues
 *
 * Reads Gadgetbridge.db directly (read-only) for raw stages/HR/SpO2; reads
 * insights/daily/<date>/_facts.json for summary/baseline context.
 */

import type Database from "better-sqlite3";
import { dayWindow } from "../../../facts/window.ts";
import {
  readFactsForDate,
  shiftDateKey,
  shortHash,
  type SlotBuildContext,
  type SlotPackage,
} from "../_shared.ts";

// ── Types ────────────────────────────────────────────────────────────────

export type SleepStage = "light" | "rem" | "deep" | "awake";

export interface SleepSummary {
  tst_min: number | null;
  sleep_efficiency_pct: number | null;
  rem_min: number | null;
  deep_min: number | null;
  light_min: number | null;
  awake_min: number | null;
  rhr_sleep_bpm: number | null;
  rmssd_ms: number | null;
  spo2_min_pct: number | null;
  breath_rate_mean: number | null;
  sleep_latency_min: number | null;
  wake_count: number | null;
  bedtime_iso: string | null;
  wake_iso: string | null;
  midpoint_min: number | null;
  tib_min: number | null;
  coverage_pct: number | null;
}

export interface StageSegment {
  start_iso: string;
  end_iso: string;
  stage: SleepStage;
  duration_min: number;
}

export interface HrBucket {
  ts_iso: string;
  bpm_mean: number;
  bpm_min: number;
  bpm_max: number;
  n_samples: number;
}

export interface Spo2Bucket {
  ts_iso: string;
  pct_mean: number;
  pct_min: number;
  n_samples: number;
}

export interface NightSummary {
  date: string;
  tst_min: number | null;
  sleep_efficiency_pct: number | null;
  rem_min: number | null;
  deep_min: number | null;
  awake_min: number | null;
  rhr_sleep_bpm: number | null;
  rmssd_ms: number | null;
  sleep_latency_min: number | null;
  midpoint_min: number | null;
}

export interface DayAggregate {
  date: string;
  tst_min: number | null;
  sleep_efficiency_pct: number | null;
  midpoint_min: number | null;
  rhr_sleep_bpm: number | null;
  rmssd_ms: number | null;
}

export interface BaselineStat {
  median: number | null;
  mad: number | null;
  n: number;
}

export type DeltaBand = "high" | "medium" | "within" | "no_baseline";

export interface MetricDelta {
  value: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
  z_score: number | null;
  band: DeltaBand;
}

export interface WorkoutEntry {
  ts_start_iso: string;
  ts_end_iso: string;
  kind: number;
  name: string | null;
  duration_min: number;
  active_calories: number | null;
  distance_m: number | null;
  workout_load: number | null;
}

export interface NightReviewDomain {
  today_summary: SleepSummary;
  stages_timeline: StageSegment[];
  hr_5min: HrBucket[];
  spo2_5min: Spo2Bucket[];
  last_2_nights: NightSummary[];
  days_3_to_7: DayAggregate[];
  baselines_30d: Record<string, BaselineStat>;
  deltas_today: Record<string, MetricDelta>;
  workout_context: {
    yesterday_workouts: WorkoutEntry[];
  };
  stress_context: {
    yesterday: { mean: number | null; max: number | null; high_stress_min: number | null };
  };
  data_quality: {
    wear_hours_today: number | null;
    missing_nights_in_7d: number;
    signal_issues: string[];
  };
}

export type NightReviewPackage = SlotPackage<NightReviewDomain>;

const STAGE_CODE: Record<number, SleepStage> = { 1: "light", 2: "rem", 3: "deep", 4: "awake" };
const BUCKET_MS = 5 * 60 * 1000;
const TZ_DEFAULT = "Europe/Berlin";
const MAX_NIGHT_MS = 18 * 3600 * 1000;

const METRIC_KEYS = [
  "tst_min",
  "sleep_efficiency_pct",
  "rem_min",
  "deep_min",
  "rhr_sleep_bpm",
  "rmssd_ms",
  "spo2_min_pct",
] as const;

// ── Public ────────────────────────────────────────────────────────────────

export async function buildNightReviewPackage(
  ctx: SlotBuildContext,
): Promise<NightReviewPackage> {
  const tz = ctx.tz ?? TZ_DEFAULT;
  const win = dayWindow(ctx.period_key, tz);
  const facts = readFactsForDate(ctx.insights_root, ctx.period_key);

  const stats = readSleepStats(ctx.db, win.startMs as number, win.endMs as number);
  const [safeStart, safeEnd] = resolveSleepWindow(stats, win.startMs as number, win.endMs as number);

  const stages = collapseStages(ctx.db, safeStart, safeEnd, tz);
  const hr = bucketHr(ctx.db, safeStart, safeEnd, tz);
  const spo2 = bucketSpo2(ctx.db, safeStart, safeEnd, tz);

  const todaySummary = buildTodaySummary(facts, stats, tz);

  const last2 = readNeighborNights(ctx.insights_root, ctx.period_key, [1, 2]);
  const days37 = readDayAggregates(ctx.insights_root, ctx.period_key, [3, 4, 5, 6, 7]);

  const baselines = collectBaselines(facts);
  const deltas = computeDeltas(todaySummary, baselines);

  const yWin = dayWindow(shiftDateKey(ctx.period_key, 1), tz);
  const yesterdayWorkouts = readWorkouts(ctx.db, yWin.startMs as number, yWin.endMs as number, tz);
  const yesterdayFacts = readFactsForDate(ctx.insights_root, shiftDateKey(ctx.period_key, 1));
  const yStress = (
    (yesterdayFacts?.stress as { metrics?: Record<string, number | null> } | undefined)?.metrics ??
    {}
  );

  const wearSec = (facts?.device as { wear_seconds_24h?: number } | undefined)?.wear_seconds_24h;
  const wearH = typeof wearSec === "number" ? round1(wearSec / 3600) : null;
  const signalIssues =
    (facts?.sleep as { signal_quality?: { issues?: string[] } } | undefined)?.signal_quality
      ?.issues ?? [];
  const missing7 = countMissingNights(ctx.insights_root, ctx.period_key);

  return {
    meta: {
      period_key: ctx.period_key,
      generated_at: ctx.now.toISOString(),
      tz,
      package_version: "night-review-package/v1",
    },
    tier1_snapshot: ctx.tier1,
    prior: {},
    domain: {
      today_summary: todaySummary,
      stages_timeline: stages,
      hr_5min: hr,
      spo2_5min: spo2,
      last_2_nights: last2,
      days_3_to_7: days37,
      baselines_30d: baselines,
      deltas_today: deltas,
      workout_context: { yesterday_workouts: yesterdayWorkouts },
      stress_context: {
        yesterday: {
          mean: (yStress.stress_mean as number | undefined) ?? null,
          max: (yStress.stress_max as number | undefined) ?? null,
          high_stress_min: (yStress.high_stress_minutes as number | undefined) ?? null,
        },
      },
      data_quality: {
        wear_hours_today: wearH,
        missing_nights_in_7d: missing7,
        signal_issues: signalIssues,
      },
    },
  };
}

/** Stable cache key for a built package (used in InputsUsed.facts_hash). */
export function nightReviewFactsHash(pkg: NightReviewPackage): string {
  return shortHash({
    period_key: pkg.meta.period_key,
    today: pkg.domain.today_summary,
    deltas: pkg.domain.deltas_today,
  });
}

// ── DB reads ─────────────────────────────────────────────────────────────

interface SleepStatsRow {
  BED_TIME: number | null;
  WAKEUP_TIME: number | null;
  SLEEP_EFFICIENCY: number | null;
  AVG_HRV: number | null;
  AVG_OXYGEN_SATURATION: number | null;
  MIN_HEART_RATE: number | null;
  MAX_HEART_RATE: number | null;
  AVG_BREATH_RATE: number | null;
  WAKE_COUNT: number | null;
  SLEEP_LATENCY: number | null;
}

function readSleepStats(
  db: Database.Database,
  startMs: number,
  endMs: number,
): SleepStatsRow | null {
  try {
    return (
      db
        .prepare<[number, number], SleepStatsRow>(
          `SELECT BED_TIME, WAKEUP_TIME, SLEEP_EFFICIENCY,
                  AVG_HRV, AVG_OXYGEN_SATURATION,
                  MIN_HEART_RATE, MAX_HEART_RATE,
                  AVG_BREATH_RATE, WAKE_COUNT, SLEEP_LATENCY
           FROM HUAWEI_SLEEP_STATS_SAMPLE
           WHERE WAKEUP_TIME >= ? AND WAKEUP_TIME < ?
           ORDER BY WAKEUP_TIME DESC LIMIT 1`,
        )
        .get(startMs, endMs) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Pin the sleep window: `BED_TIME`/`WAKEUP_TIME` are sometimes 0 or -1
 * sentinels. When they are valid, use them clamped to ≤18h to defend
 * against a single bad row collapsing the full DB into one query.
 */
function resolveSleepWindow(
  stats: SleepStatsRow | null,
  winStart: number,
  winEnd: number,
): [number, number] {
  const rawBed = stats?.BED_TIME ?? null;
  const rawWake = stats?.WAKEUP_TIME ?? null;
  const sleepStart = rawBed && rawBed > 0 ? rawBed : winStart;
  const sleepEnd = rawWake && rawWake > 0 ? rawWake : winEnd;
  const naive = sleepStart < sleepEnd ? sleepStart : winStart;
  const safeStart = Math.max(naive, sleepEnd - MAX_NIGHT_MS);
  return [safeStart, sleepEnd > safeStart ? sleepEnd : winEnd];
}

interface StageRow {
  TIMESTAMP: number;
  STAGE: number;
}

function collapseStages(
  db: Database.Database,
  startMs: number,
  endMs: number,
  tz: string,
): StageSegment[] {
  const rows = db
    .prepare<[number, number], StageRow>(
      `SELECT TIMESTAMP, STAGE
       FROM HUAWEI_SLEEP_STAGE_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
       ORDER BY TIMESTAMP ASC`,
    )
    .all(startMs, endMs);
  if (rows.length === 0) return [];

  const out: StageSegment[] = [];
  let segStart = rows[0].TIMESTAMP;
  let segStage = rows[0].STAGE;
  let segEnd = rows[0].TIMESTAMP + 60_000;
  const push = (start: number, end: number, stageCode: number) => {
    const stage = STAGE_CODE[stageCode];
    if (!stage) return;
    const dur = Math.round((end - start) / 60_000);
    if (dur <= 0) return;
    out.push({
      start_iso: msIso(start, tz),
      end_iso: msIso(end, tz),
      stage,
      duration_min: dur,
    });
  };
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const gap = r.TIMESTAMP - segEnd;
    if (r.STAGE === segStage && Math.abs(gap) < 90_000) {
      segEnd = r.TIMESTAMP + 60_000;
    } else {
      push(segStart, segEnd, segStage);
      segStart = r.TIMESTAMP;
      segStage = r.STAGE;
      segEnd = r.TIMESTAMP + 60_000;
    }
  }
  push(segStart, segEnd, segStage);
  return out;
}

interface ActivityRow {
  TIMESTAMP: number;
  HEART_RATE: number | null;
  SPO: number | null;
}

function bucketHr(
  db: Database.Database,
  startMs: number,
  endMs: number,
  tz: string,
): HrBucket[] {
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const rows = db
    .prepare<[number, number], ActivityRow>(
      `SELECT TIMESTAMP, HEART_RATE, SPO
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND HEART_RATE BETWEEN 30 AND 220
       ORDER BY TIMESTAMP ASC`,
    )
    .all(startSec, endSec);
  return bucketize<ActivityRow, HrBucket>(
    rows,
    (r) => r.TIMESTAMP * 1000,
    (r) => r.HEART_RATE,
    (ts, vals) => ({
      ts_iso: msIso(ts, tz),
      bpm_mean: Math.round(mean(vals)),
      bpm_min: Math.min(...vals),
      bpm_max: Math.max(...vals),
      n_samples: vals.length,
    }),
  );
}

function bucketSpo2(
  db: Database.Database,
  startMs: number,
  endMs: number,
  tz: string,
): Spo2Bucket[] {
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const rows = db
    .prepare<[number, number], ActivityRow>(
      `SELECT TIMESTAMP, HEART_RATE, SPO
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND SPO BETWEEN 50 AND 100
       ORDER BY TIMESTAMP ASC`,
    )
    .all(startSec, endSec);
  return bucketize<ActivityRow, Spo2Bucket>(
    rows,
    (r) => r.TIMESTAMP * 1000,
    (r) => r.SPO,
    (ts, vals) => ({
      ts_iso: msIso(ts, tz),
      pct_mean: Math.round(mean(vals) * 10) / 10,
      pct_min: Math.min(...vals),
      n_samples: vals.length,
    }),
  );
}

function bucketize<TRow, TOut>(
  rows: TRow[],
  ts: (r: TRow) => number,
  val: (r: TRow) => number | null,
  emit: (bucketStartMs: number, vals: number[]) => TOut,
): TOut[] {
  if (rows.length === 0) return [];
  const out: TOut[] = [];
  let bucketStart = Math.floor(ts(rows[0]) / BUCKET_MS) * BUCKET_MS;
  let vals: number[] = [];
  for (const r of rows) {
    const v = val(r);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const t = ts(r);
    const thisBucket = Math.floor(t / BUCKET_MS) * BUCKET_MS;
    if (thisBucket !== bucketStart) {
      if (vals.length > 0) out.push(emit(bucketStart, vals));
      bucketStart = thisBucket;
      vals = [];
    }
    vals.push(v);
  }
  if (vals.length > 0) out.push(emit(bucketStart, vals));
  return out;
}

// ── Facts-side reads ─────────────────────────────────────────────────────

function buildTodaySummary(
  facts: Record<string, unknown> | null,
  stats: SleepStatsRow | null,
  tz: string,
): SleepSummary {
  const m = ((facts?.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics ??
    {}) as Record<string, number | null>;
  const bedValid = stats?.BED_TIME && stats.BED_TIME > 0 ? stats.BED_TIME : null;
  const wakeValid = stats?.WAKEUP_TIME && stats.WAKEUP_TIME > 0 ? stats.WAKEUP_TIME : null;
  const midpointMs = bedValid && wakeValid ? Math.round((bedValid + wakeValid) / 2) : null;
  const midpointMin = midpointMs ? msLocalMinutes(midpointMs, tz) : null;
  const tibMin =
    bedValid && wakeValid && wakeValid > bedValid
      ? Math.round((wakeValid - bedValid) / 60000)
      : null;
  const totalStage =
    (m.rem_min ?? 0) + (m.deep_min ?? 0) + (m.light_min ?? 0) + (m.awake_min ?? 0);
  const coveragePct = tibMin && tibMin > 0 ? Math.round((totalStage / tibMin) * 100) : null;

  return {
    tst_min: m.tst_min ?? null,
    sleep_efficiency_pct: m.sleep_efficiency_pct ?? null,
    rem_min: m.rem_min ?? null,
    deep_min: m.deep_min ?? null,
    light_min: m.light_min ?? null,
    awake_min: m.awake_min ?? null,
    rhr_sleep_bpm: m.rhr_sleep_bpm ?? null,
    rmssd_ms: m.rmssd_ms ?? null,
    spo2_min_pct: m.spo2_min_pct ?? null,
    breath_rate_mean: m.breath_rate_mean ?? null,
    sleep_latency_min: m.sleep_latency_min ?? null,
    wake_count: m.wake_count ?? null,
    bedtime_iso: bedValid ? msIso(bedValid, tz) : null,
    wake_iso: wakeValid ? msIso(wakeValid, tz) : null,
    midpoint_min: midpointMin,
    tib_min: tibMin,
    coverage_pct: coveragePct,
  };
}

function readNeighborNights(
  insightsRoot: string,
  periodKey: string,
  daysBack: number[],
): NightSummary[] {
  const out: NightSummary[] = [];
  for (const back of daysBack) {
    const date = shiftDateKey(periodKey, back);
    const facts = readFactsForDate(insightsRoot, date);
    if (!facts) continue;
    const m = ((facts.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics ??
      {}) as Record<string, number | null>;
    out.push({
      date,
      tst_min: m.tst_min ?? null,
      sleep_efficiency_pct: m.sleep_efficiency_pct ?? null,
      rem_min: m.rem_min ?? null,
      deep_min: m.deep_min ?? null,
      awake_min: m.awake_min ?? null,
      rhr_sleep_bpm: m.rhr_sleep_bpm ?? null,
      rmssd_ms: m.rmssd_ms ?? null,
      sleep_latency_min: m.sleep_latency_min ?? null,
      midpoint_min:
        m.bedtime_min != null && m.wakeup_min != null
          ? Math.round((m.bedtime_min + m.wakeup_min) / 2)
          : null,
    });
  }
  return out;
}

function readDayAggregates(
  insightsRoot: string,
  periodKey: string,
  daysBack: number[],
): DayAggregate[] {
  const out: DayAggregate[] = [];
  for (const back of daysBack) {
    const date = shiftDateKey(periodKey, back);
    const facts = readFactsForDate(insightsRoot, date);
    if (!facts) continue;
    const m = ((facts.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics ??
      {}) as Record<string, number | null>;
    out.push({
      date,
      tst_min: m.tst_min ?? null,
      sleep_efficiency_pct: m.sleep_efficiency_pct ?? null,
      midpoint_min:
        m.bedtime_min != null && m.wakeup_min != null
          ? Math.round((m.bedtime_min + m.wakeup_min) / 2)
          : null,
      rhr_sleep_bpm: m.rhr_sleep_bpm ?? null,
      rmssd_ms: m.rmssd_ms ?? null,
    });
  }
  return out;
}

function collectBaselines(
  facts: Record<string, unknown> | null,
): Record<string, BaselineStat> {
  const out: Record<string, BaselineStat> = {};
  if (!facts) return out;
  const baseline =
    ((facts.sleep as { baseline?: Record<string, BaselineStat> } | undefined)?.baseline) ?? {};
  for (const k of METRIC_KEYS) {
    const b = baseline[k];
    if (b && (b.median != null || b.mad != null)) {
      out[k] = { median: b.median ?? null, mad: b.mad ?? null, n: b.n ?? 0 };
    }
  }
  return out;
}

function computeDeltas(
  summary: SleepSummary,
  baselines: Record<string, BaselineStat>,
): Record<string, MetricDelta> {
  const out: Record<string, MetricDelta> = {};
  for (const k of METRIC_KEYS) {
    const value = (summary as unknown as Record<string, number | null>)[k] ?? null;
    const b = baselines[k];
    if (value == null || !b || b.median == null) {
      out[k] = { value, delta_abs: null, delta_pct: null, z_score: null, band: "no_baseline" };
      continue;
    }
    const deltaAbs = value - b.median;
    const deltaPct = b.median !== 0 ? (deltaAbs / b.median) * 100 : null;
    const z = b.mad != null && b.mad > 0 ? robustZ(value, b.median, b.mad) : null;
    const band: DeltaBand =
      z == null ? "no_baseline" : Math.abs(z) >= 2 ? "high" : Math.abs(z) >= 1 ? "medium" : "within";
    out[k] = {
      value,
      delta_abs: round1(deltaAbs),
      delta_pct: deltaPct != null ? round1(deltaPct) : null,
      z_score: z != null ? round1(z) : null,
      band,
    };
  }
  return out;
}

interface WorkoutRow {
  START_TIME: number;
  END_TIME: number;
  ACTIVITY_KIND: number;
  NAME: string | null;
  SUMMARY_DATA: string | null;
}

function readWorkouts(
  db: Database.Database,
  startMs: number,
  endMs: number,
  tz: string,
): WorkoutEntry[] {
  let rows: WorkoutRow[] = [];
  try {
    rows = db
      .prepare<[number, number], WorkoutRow>(
        `SELECT START_TIME, END_TIME, ACTIVITY_KIND, NAME, SUMMARY_DATA
         FROM BASE_ACTIVITY_SUMMARY
         WHERE START_TIME >= ? AND START_TIME < ?
         ORDER BY START_TIME ASC`,
      )
      .all(startMs, endMs);
  } catch {
    return [];
  }
  return rows.map((r) => {
    const sd = parseSummary(r.SUMMARY_DATA);
    const dur = Math.max(0, Math.round((r.END_TIME - r.START_TIME) / 60_000));
    return {
      ts_start_iso: msIso(r.START_TIME, tz),
      ts_end_iso: msIso(r.END_TIME, tz),
      kind: r.ACTIVITY_KIND,
      name: r.NAME,
      duration_min: dur,
      active_calories: nf(sd, "active_calories"),
      distance_m: nf(sd, "distanceMeters"),
      workout_load: nf(sd, "currentWorkoutLoad"),
    };
  });
}

function parseSummary(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nf(sd: Record<string, unknown> | null, key: string): number | null {
  if (!sd) return null;
  const node = sd[key];
  if (node && typeof node === "object" && "value" in (node as Record<string, unknown>)) {
    const v = (node as { value: unknown }).value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

function countMissingNights(insightsRoot: string, periodKey: string): number {
  let missing = 0;
  for (let back = 1; back <= 7; back++) {
    const date = shiftDateKey(periodKey, back);
    const facts = readFactsForDate(insightsRoot, date);
    const tst = (facts?.sleep as { metrics?: { tst_min?: number | null } } | undefined)?.metrics
      ?.tst_min;
    if (!tst) missing++;
  }
  return missing;
}

// ── Math helpers (local to keep the slot import-self-contained) ──────────

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function robustZ(value: number, median: number, mad: number): number {
  if (mad <= 0) return 0;
  return (value - median) / (1.4826 * mad);
}

function msIso(ms: number, tz: string): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const yyyy = get("year");
  const mo = get("month");
  const dd = get("day");
  let hh = get("hour");
  if (hh === "24") hh = "00";
  const mi = get("minute");
  const ss = get("second");
  const local = `${yyyy}-${mo}-${dd}T${hh}:${mi}:${ss}`;
  const utcMs = Date.UTC(Number(yyyy), Number(mo) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  const offsetMin = Math.round((utcMs - d.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${local}${sign}${oh}:${om}`;
}

function msLocalMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}
