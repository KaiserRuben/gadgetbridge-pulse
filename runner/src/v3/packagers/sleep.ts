/**
 * Sleep use-case packager (v3).
 *
 * Self-contained: reads Gadgetbridge.db directly for raw series and
 * neighbor _facts.json files for summary context. No upstream changes
 * required.
 *
 * Tier structure:
 *   Tier 1: tonight full (summary + stages timeline + 5-min HR/SpO2 buckets)
 *   Tier 2: last 2 nights (summary only)
 *   Tier 3: days 3-7 (daily aggregates only)
 *   Tier 4: 30d baselines (median, MAD, n)
 *   Tier 5: deltas today vs baseline (deterministic z-scores + bands)
 *   Tier 6: context (workouts, stress, late-evening movement, data quality)
 */

import type Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { dayWindow, shiftDateKey } from "../../facts/window.ts";
import { median, mad, zRobust } from "../../rules/stats.ts";
import { msToLocalIso } from "./shared.ts";

// ── Types ────────────────────────────────────────────────────────────────────

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
  rdi: number | null;
  apnea_events_count: number | null;
  apnea_max_level: number | null;
  bedtime_iso: string | null;
  wake_iso: string | null;
  midpoint_iso: string | null;
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
  light_min: number | null;
  awake_min: number | null;
  rhr_sleep_bpm: number | null;
  rmssd_ms: number | null;
  sleep_latency_min: number | null;
  midpoint_min: number | null;
  bedtime_iso: string | null;
  wake_iso: string | null;
}

export interface DayAggregate {
  date: string;
  tst_min: number | null;
  sleep_efficiency_pct: number | null;
  rem_min: number | null;
  deep_min: number | null;
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
  steps: number | null;
  avg_speed_mps: number | null;
  workout_load: number | null;
  aerobic_training_effect: number | null;
  recovery_time_h: number | null;
}

export interface SleepPackage {
  meta: {
    today_date: string;
    generated_at: string;
    tz: string;
    package_version: "sleep_package/v1";
  };
  today: {
    summary: SleepSummary;
    stages_timeline: StageSegment[];
    hr_5min: HrBucket[];
    spo2_5min: Spo2Bucket[];
  };
  last_2_nights: NightSummary[];
  days_3_to_7: DayAggregate[];
  baselines_30d: Record<string, BaselineStat>;
  deltas_today: Record<string, MetricDelta>;
  context: {
    today_workouts: WorkoutEntry[];
    yesterday_workouts: WorkoutEntry[];
    today_stress: { mean: number | null; max: number | null; high_stress_min: number | null };
    yesterday_stress: { mean: number | null; max: number | null; high_stress_min: number | null };
    late_evening_movement: boolean;
    daytime_hr_mean: number | null;
    data_quality: {
      wear_hours_today: number | null;
      missing_nights_in_7d: number;
      signal_issues: string[];
    };
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const STAGE_CODE: Record<number, SleepStage> = { 1: "light", 2: "rem", 3: "deep", 4: "awake" };
const BUCKET_MIN = 5;
const LATE_EVENING_HOUR = 22;
const LATE_EVENING_STEP_THRESHOLD = 200;

// Metrics tracked by deltas (must align with baseline keys in facts.json).
const SLEEP_METRIC_KEYS = [
  "tst_min",
  "sleep_efficiency_pct",
  "rem_min",
  "deep_min",
  "rmssd_ms",
  "spo2_min_pct",
] as const;

// ── Public entry ─────────────────────────────────────────────────────────────

export interface BuildSleepPackageOpts {
  periodKey: string;
  db: Database.Database;
  insightsRoot: string;
  tz?: string;
}

export function buildSleepPackage(opts: BuildSleepPackageOpts): SleepPackage {
  const tz = opts.tz ?? "Europe/Berlin";
  const win = dayWindow(opts.periodKey, tz);

  const factsToday = readFactsForDate(opts.insightsRoot, opts.periodKey);
  const stats = readSleepStats(opts.db, win);

  // Huawei BED_TIME may be 0 or -1 (sentinel). `??` lets those through and
  // collapses the stage query to `WHERE TIMESTAMP >= 0`, summing every night
  // in the DB. Guard explicitly and clamp to a single-night window.
  const rawBed = stats?.BED_TIME ?? null;
  const rawWake = stats?.WAKEUP_TIME ?? null;
  const sleepStartMs = rawBed && rawBed > 0 ? rawBed : (win.startMs as number);
  const sleepEndMs = rawWake && rawWake > 0 ? rawWake : (win.endMs as number);
  const naiveStart = sleepStartMs < sleepEndMs ? sleepStartMs : (win.startMs as number);
  const maxNightMs = 18 * 3600 * 1000;
  const safeStart = Math.max(naiveStart, sleepEndMs - maxNightMs);
  const safeEnd = sleepEndMs > safeStart ? sleepEndMs : (win.endMs as number);

  const stagesTimeline = collapseStagesTimeline(opts.db, safeStart, safeEnd, tz);
  const hr5min = bucketHrSleep(opts.db, safeStart, safeEnd, tz);
  const spo25min = bucketSpo2Sleep(opts.db, safeStart, safeEnd, tz);

  const todaySummary = buildTodaySummary(factsToday, stats, safeStart, safeEnd, tz);

  const last2 = readNeighborNights(opts.insightsRoot, opts.periodKey, [1, 2]);
  const days37 = readDayAggregates(opts.insightsRoot, opts.periodKey, [3, 4, 5, 6, 7]);

  const baselines = collectBaselines(factsToday);
  const deltas = computeDeltas(todaySummary, baselines);

  const context = buildContext(opts.db, opts.periodKey, factsToday, opts.insightsRoot, tz);

  return {
    meta: {
      today_date: opts.periodKey,
      generated_at: new Date().toISOString(),
      tz,
      package_version: "sleep_package/v1",
    },
    today: {
      summary: todaySummary,
      stages_timeline: stagesTimeline,
      hr_5min: hr5min,
      spo2_5min: spo25min,
    },
    last_2_nights: last2,
    days_3_to_7: days37,
    baselines_30d: baselines,
    deltas_today: deltas,
    context,
  };
}

// ── Today summary ────────────────────────────────────────────────────────────

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
  RDI: number | null;
  SLEEP_LATENCY: number | null;
}

function readSleepStats(db: Database.Database, win: ReturnType<typeof dayWindow>): SleepStatsRow | null {
  try {
    return (
      db
        .prepare<[number, number], SleepStatsRow>(
          `SELECT BED_TIME, WAKEUP_TIME, SLEEP_EFFICIENCY,
                  AVG_HRV, AVG_OXYGEN_SATURATION,
                  MIN_HEART_RATE, MAX_HEART_RATE,
                  AVG_BREATH_RATE, WAKE_COUNT, RDI, SLEEP_LATENCY
           FROM HUAWEI_SLEEP_STATS_SAMPLE
           WHERE WAKEUP_TIME >= ? AND WAKEUP_TIME < ?
           ORDER BY WAKEUP_TIME DESC LIMIT 1`,
        )
        .get(win.startMs as number, win.endMs as number) ?? null
    );
  } catch {
    return null;
  }
}

function buildTodaySummary(
  facts: Record<string, unknown> | null,
  stats: SleepStatsRow | null,
  bedMs: number,
  wakeMs: number,
  tz: string,
): SleepSummary {
  const sleepFacts = (facts?.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};
  const apneaCount = sleepFacts.apnea_events_count ?? null;
  const apneaMax = sleepFacts.apnea_max_level ?? null;

  // Huawei stores 0/-1 sentinels in BED_TIME/WAKEUP_TIME; treat ≤0 as missing.
  const bedMsValid = stats?.BED_TIME && stats.BED_TIME > 0 ? stats.BED_TIME : null;
  const wakeMsValid = stats?.WAKEUP_TIME && stats.WAKEUP_TIME > 0 ? stats.WAKEUP_TIME : null;
  const bedtimeIso = bedMsValid ? msToLocalIso(bedMsValid, tz) : null;
  const wakeIso = wakeMsValid ? msToLocalIso(wakeMsValid, tz) : null;
  const midpointMs =
    bedMsValid && wakeMsValid ? Math.round((bedMsValid + wakeMsValid) / 2) : null;
  const midpointIso = midpointMs ? msToLocalIso(midpointMs, tz) : null;
  const midpointMin = midpointMs ? msToLocalMinutes(midpointMs, tz) : null;

  const tibMin =
    bedMsValid && wakeMsValid && wakeMsValid > bedMsValid
      ? Math.round((wakeMsValid - bedMsValid) / 60000)
      : null;
  const totalStage =
    (sleepFacts.rem_min ?? 0) +
    (sleepFacts.deep_min ?? 0) +
    (sleepFacts.light_min ?? 0) +
    (sleepFacts.awake_min ?? 0);
  const coveragePct = tibMin && tibMin > 0 ? Math.round((totalStage / tibMin) * 100) : null;

  return {
    tst_min: sleepFacts.tst_min ?? null,
    sleep_efficiency_pct: sleepFacts.sleep_efficiency_pct ?? null,
    rem_min: sleepFacts.rem_min ?? null,
    deep_min: sleepFacts.deep_min ?? null,
    light_min: sleepFacts.light_min ?? null,
    awake_min: sleepFacts.awake_min ?? null,
    rhr_sleep_bpm: sleepFacts.rhr_sleep_bpm ?? null,
    rmssd_ms: sleepFacts.rmssd_ms ?? null,
    spo2_min_pct: sleepFacts.spo2_min_pct ?? null,
    breath_rate_mean: sleepFacts.breath_rate_mean ?? null,
    sleep_latency_min: sleepFacts.sleep_latency_min ?? null,
    wake_count: sleepFacts.wake_count ?? null,
    rdi: sleepFacts.rdi ?? null,
    apnea_events_count: apneaCount,
    apnea_max_level: apneaMax,
    bedtime_iso: bedtimeIso,
    wake_iso: wakeIso,
    midpoint_iso: midpointIso,
    midpoint_min: midpointMin,
    tib_min: tibMin,
    coverage_pct: coveragePct,
  };
}

// ── Stages timeline ──────────────────────────────────────────────────────────

interface StageRow {
  TIMESTAMP: number;
  STAGE: number;
}

function collapseStagesTimeline(
  db: Database.Database,
  startMs: number,
  endMs: number,
  _tz: string,
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

  // Each row = 1 minute. Collapse consecutive same-stage rows into segments.
  const segments: StageSegment[] = [];
  let segStart = rows[0].TIMESTAMP;
  let segStage = rows[0].STAGE;
  let segEnd = rows[0].TIMESTAMP + 60_000;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const expectedNext = segEnd;
    const gap = r.TIMESTAMP - expectedNext;
    if (r.STAGE === segStage && Math.abs(gap) < 90_000) {
      segEnd = r.TIMESTAMP + 60_000;
    } else {
      pushSeg(segments, segStart, segEnd, segStage, _tz);
      segStart = r.TIMESTAMP;
      segStage = r.STAGE;
      segEnd = r.TIMESTAMP + 60_000;
    }
  }
  pushSeg(segments, segStart, segEnd, segStage, _tz);

  return segments;
}

function pushSeg(
  out: StageSegment[],
  startMs: number,
  endMs: number,
  stageCode: number,
  tz: string,
) {
  const stage = STAGE_CODE[stageCode];
  if (!stage) return;
  const durMin = Math.round((endMs - startMs) / 60_000);
  if (durMin <= 0) return;
  out.push({
    start_iso: msToLocalIso(startMs, tz),
    end_iso: msToLocalIso(endMs, tz),
    stage,
    duration_min: durMin,
  });
}

// ── HR / SpO2 buckets ────────────────────────────────────────────────────────

interface ActivityRow {
  TIMESTAMP: number;
  HEART_RATE: number | null;
  SPO: number | null;
}

function bucketHrSleep(
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

  return bucketize(
    rows,
    (r) => r.TIMESTAMP * 1000,
    (r) => r.HEART_RATE,
    (ts, vals) => ({
      ts_iso: msToLocalIso(ts, tz),
      bpm_mean: Math.round(mean(vals)),
      bpm_min: Math.min(...vals),
      bpm_max: Math.max(...vals),
      n_samples: vals.length,
    }),
  );
}

function bucketSpo2Sleep(
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

  return bucketize(
    rows,
    (r) => r.TIMESTAMP * 1000,
    (r) => r.SPO,
    (ts, vals) => ({
      ts_iso: msToLocalIso(ts, tz),
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
  const bucketMs = BUCKET_MIN * 60_000;
  let bucketStart = Math.floor(ts(rows[0]) / bucketMs) * bucketMs;
  let bucketVals: number[] = [];
  for (const r of rows) {
    const v = val(r);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const t = ts(r);
    const thisBucket = Math.floor(t / bucketMs) * bucketMs;
    if (thisBucket !== bucketStart) {
      if (bucketVals.length > 0) out.push(emit(bucketStart, bucketVals));
      bucketStart = thisBucket;
      bucketVals = [];
    }
    bucketVals.push(v);
  }
  if (bucketVals.length > 0) out.push(emit(bucketStart, bucketVals));
  return out;
}

// ── Neighbor nights / day aggregates ─────────────────────────────────────────

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
    const m = ((facts.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {}) as Record<string, number | null>;
    out.push({
      date,
      tst_min: m.tst_min ?? null,
      sleep_efficiency_pct: m.sleep_efficiency_pct ?? null,
      rem_min: m.rem_min ?? null,
      deep_min: m.deep_min ?? null,
      light_min: m.light_min ?? null,
      awake_min: m.awake_min ?? null,
      rhr_sleep_bpm: m.rhr_sleep_bpm ?? null,
      rmssd_ms: m.rmssd_ms ?? null,
      sleep_latency_min: m.sleep_latency_min ?? null,
      midpoint_min:
        m.bedtime_min != null && m.wakeup_min != null
          ? Math.round((m.bedtime_min + m.wakeup_min) / 2)
          : null,
      bedtime_iso: null,
      wake_iso: null,
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
    const m = ((facts.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {}) as Record<string, number | null>;
    out.push({
      date,
      tst_min: m.tst_min ?? null,
      sleep_efficiency_pct: m.sleep_efficiency_pct ?? null,
      rem_min: m.rem_min ?? null,
      deep_min: m.deep_min ?? null,
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

// ── Baselines + deltas ───────────────────────────────────────────────────────

function collectBaselines(facts: Record<string, unknown> | null): Record<string, BaselineStat> {
  const out: Record<string, BaselineStat> = {};
  if (!facts) return out;
  const sleepBaseline = ((facts.sleep as { baseline?: Record<string, BaselineStat> } | undefined)?.baseline) ?? {};
  for (const k of SLEEP_METRIC_KEYS) {
    const b = sleepBaseline[k];
    if (b && (b.median != null || b.mad != null)) {
      out[k] = { median: b.median ?? null, mad: b.mad ?? null, n: b.n ?? 0 };
    }
  }
  // midpoint not in facts baseline yet — derive from days_3_to_7 + last_2 if needed.
  return out;
}

function computeDeltas(
  summary: SleepSummary,
  baselines: Record<string, BaselineStat>,
): Record<string, MetricDelta> {
  const out: Record<string, MetricDelta> = {};
  for (const k of SLEEP_METRIC_KEYS) {
    const value = (summary as unknown as Record<string, number | null>)[k] ?? null;
    const b = baselines[k];
    if (value == null || !b || b.median == null) {
      out[k] = { value, delta_abs: null, delta_pct: null, z_score: null, band: "no_baseline" };
      continue;
    }
    const deltaAbs = value - b.median;
    const deltaPct = b.median !== 0 ? (deltaAbs / b.median) * 100 : null;
    const z = b.mad != null && b.mad > 0 ? zRobust(value, b.median, b.mad) : null;
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

// ── Context (workouts, stress, late movement) ────────────────────────────────

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
  return rows.map((r) => parseWorkout(r, tz));
}

function parseWorkout(r: WorkoutRow, tz: string): WorkoutEntry {
  const sd = parseSummaryData(r.SUMMARY_DATA);
  const durMin = Math.max(0, Math.round((r.END_TIME - r.START_TIME) / 60_000));
  return {
    ts_start_iso: msToLocalIso(r.START_TIME, tz),
    ts_end_iso: msToLocalIso(r.END_TIME, tz),
    kind: r.ACTIVITY_KIND,
    name: r.NAME,
    duration_min: durMin,
    active_calories: numFromSd(sd, "active_calories"),
    distance_m: numFromSd(sd, "distanceMeters"),
    steps: numFromSd(sd, "steps"),
    avg_speed_mps: numFromSd(sd, "averageSpeed"),
    workout_load: numFromSd(sd, "currentWorkoutLoad"),
    aerobic_training_effect: numFromSd(sd, "aerobicTrainingEffect"),
    recovery_time_h: numFromSd(sd, "recoveryTime"),
  };
}

function parseSummaryData(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function numFromSd(sd: Record<string, unknown> | null, key: string): number | null {
  if (!sd) return null;
  const node = sd[key];
  if (node && typeof node === "object" && "value" in (node as Record<string, unknown>)) {
    const v = (node as { value: unknown }).value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

function buildContext(
  db: Database.Database,
  periodKey: string,
  factsToday: Record<string, unknown> | null,
  insightsRoot: string,
  tz: string,
): SleepPackage["context"] {
  const win = dayWindow(periodKey, tz);
  const yWin = dayWindow(shiftDateKey(periodKey, 1), tz);

  const todayWorkouts = readWorkouts(db, win.startMs as number, win.endMs as number, tz);
  const yesterdayWorkouts = readWorkouts(db, yWin.startMs as number, yWin.endMs as number, tz);

  const stressToday = (factsToday?.stress as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};
  const factsYesterday = readFactsForDate(insightsRoot, shiftDateKey(periodKey, 1));
  const stressYesterday =
    (factsYesterday?.stress as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};

  const lateEvening = stepsAfter(db, win.startMs as number, win.endMs as number, LATE_EVENING_HOUR, tz);

  const cardioMetrics =
    ((factsToday?.cardio as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
  const sleepIssues =
    ((factsToday?.sleep as { signal_quality?: { issues?: string[] } } | undefined)?.signal_quality?.issues) ?? [];

  const wearSec = (factsToday?.device as { wear_seconds_24h?: number } | undefined)?.wear_seconds_24h;
  const wearH = typeof wearSec === "number" ? round1(wearSec / 3600) : null;

  const missing7 = countMissingNights(insightsRoot, periodKey);

  return {
    today_workouts: todayWorkouts,
    yesterday_workouts: yesterdayWorkouts,
    today_stress: {
      mean: stressToday.stress_mean ?? null,
      max: stressToday.stress_max ?? null,
      high_stress_min: stressToday.high_stress_minutes ?? null,
    },
    yesterday_stress: {
      mean: stressYesterday.stress_mean ?? null,
      max: stressYesterday.stress_max ?? null,
      high_stress_min: stressYesterday.high_stress_minutes ?? null,
    },
    late_evening_movement: lateEvening > LATE_EVENING_STEP_THRESHOLD,
    daytime_hr_mean: (cardioMetrics.hr_mean_bpm as number | undefined) ?? null,
    data_quality: {
      wear_hours_today: wearH,
      missing_nights_in_7d: missing7,
      signal_issues: sleepIssues,
    },
  };
}

function stepsAfter(
  db: Database.Database,
  startMs: number,
  endMs: number,
  fromHourLocal: number,
  tz: string,
): number {
  const cutoffSec = startMs / 1000 + fromHourLocal * 3600;
  const endSec = endMs / 1000;
  try {
    const row = db
      .prepare<[number, number], { total: number | null }>(
        `SELECT SUM(STEPS) AS total
         FROM HUAWEI_ACTIVITY_SAMPLE
         WHERE TIMESTAMP >= ? AND TIMESTAMP < ? AND STEPS > 0`,
      )
      .get(Math.floor(cutoffSec), Math.floor(endSec));
    void tz;
    return row?.total ?? 0;
  } catch {
    return 0;
  }
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function readFactsForDate(insightsRoot: string | null, date: string): Record<string, unknown> | null {
  if (!insightsRoot) return null;
  const p = path.join(insightsRoot, "daily", date, "_facts.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function msToLocalMinutes(ms: number, tz: string): number {
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

// Re-exports for convenience.
export { median, mad, zRobust };
