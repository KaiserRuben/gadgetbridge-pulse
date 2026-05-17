/**
 * Activity use-case packager (v3).
 *
 * Reads Gadgetbridge.db for raw workouts / step buckets / awake-HR / sedentary
 * blocks and neighbor _facts.json files for summaries + 30d baselines.
 */

import type Database from "better-sqlite3";
import { dayWindow, shiftDateKey } from "../../facts/window.ts";
import { queryWorkouts, dominantHrZone, type WorkoutFactsItem } from "../../facts/queries/workouts.ts";
import {
  bucketBy,
  computeDeltas,
  mean,
  pickBaselines,
  readFactsForDate,
  round1,
  type BaselineStat,
  type MetricDelta,
} from "./shared.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkoutFull {
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
  hr_avg: number | null;
  hr_max: number | null;
  hr_min: number | null;
  hr_drift_bpm_per_min: number | null;
  hr_zone_secs: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  dominant_hr_zone: "z1" | "z2" | "z3" | "z4" | "z5" | null;
}

export interface StepsHourly {
  hour: number;
  steps: number;
}

export interface SedentaryBlock {
  start_iso: string;
  end_iso: string;
  duration_min: number;
}

export interface AwakeHrBucket {
  ts_iso: string;
  bpm_mean: number;
  bpm_max: number;
  n_samples: number;
}

export interface HrZones {
  z1_min: number;
  z2_min: number;
  z3_min: number;
  z4_min: number;
  z5_min: number;
}

export interface ActivityDayAggregate {
  date: string;
  steps: number | null;
  active_minutes: number | null;
  sedentary_minutes: number | null;
  workout_load_total: number;
  workout_count: number;
}

export interface ActivityPackage {
  meta: {
    today_date: string;
    generated_at: string;
    tz: string;
    package_version: "activity_package/v1";
  };
  today: {
    workouts: WorkoutFull[];
    steps: { total: number | null; hourly: StepsHourly[]; target: number };
    active_minutes: number | null;
    sedentary_minutes: number | null;
    sedentary_blocks: SedentaryBlock[];
    calories_kcal: number | null;
    distance_m: number | null;
    hr_5min_awake: AwakeHrBucket[];
    hr_zones: HrZones;
  };
  last_2_days: ActivityDayAggregate[];
  days_3_to_7: ActivityDayAggregate[];
  baselines_30d: Record<string, BaselineStat>;
  deltas_today: Record<string, MetricDelta>;
  context: {
    last_night_sleep: {
      tst_min: number | null;
      sleep_efficiency_pct: number | null;
      rmssd_ms: number | null;
      deep_min: number | null;
    };
    recovery_state_today: {
      rhr_drift_bpm: number | null;
      hrv_latest_ms: number | null;
    };
    cumulative_load_7d: number;
    cumulative_load_baseline_7d: number | null;
    data_quality: {
      wear_hours_today: number | null;
      missing_days_in_7d: number;
      signal_issues: string[];
    };
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const HR_BUCKET_MIN = 5;
const STEP_TARGET_DEFAULT = 7000;
const SEDENTARY_BLOCK_MIN_DURATION = 30;
const ACTIVITY_METRIC_KEYS = [
  "steps",
  "active_minutes",
  "sedentary_minutes",
  "calories_kcal",
] as const;
const SLEEP_METRIC_KEYS = ["tst_min", "sleep_efficiency_pct", "deep_min", "rmssd_ms"] as const;

// HR zones — % of HRmax (assumed 220-age, conservative). Falls back to fixed bands.
const ZONE_BOUNDS = {
  z1: [0, 110],
  z2: [110, 130],
  z3: [130, 150],
  z4: [150, 170],
  z5: [170, 220],
} as const;

// ── Public entry ─────────────────────────────────────────────────────────────

export interface BuildActivityPackageOpts {
  periodKey: string;
  db: Database.Database;
  insightsRoot: string;
  tz?: string;
}

export function buildActivityPackage(opts: BuildActivityPackageOpts): ActivityPackage {
  const tz = opts.tz ?? "Europe/Berlin";
  const win = dayWindow(opts.periodKey, tz);
  const factsToday = readFactsForDate(opts.insightsRoot, opts.periodKey);

  const sleepFacts = ((factsToday?.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
  const cardioFacts = ((factsToday?.cardio as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
  const activityFacts = ((factsToday?.activity as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};

  const ageYears = (factsToday?.user as { age?: number | null } | undefined)?.age ?? null;
  const workouts = readWorkouts(opts.db, win, ageYears, tz);
  const stepsHourly = readStepsHourly(opts.db, win.startMs as number, win.endMs as number, tz);
  const stepsTotal = stepsHourly.reduce((s, h) => s + h.steps, 0);
  const sedentaryBlocks = readSedentaryBlocks(opts.db, win.startMs as number, win.endMs as number);
  const awakeHr = readAwakeHrBuckets(opts.db, win.startMs as number, win.endMs as number, sleepFacts);
  const hrZones = computeHrZones(opts.db, win.startMs as number, win.endMs as number, sleepFacts);

  const last2 = readActivityAggregates(opts.insightsRoot, opts.periodKey, [1, 2], opts.db, tz, ageYears);
  const days37 = readActivityAggregates(opts.insightsRoot, opts.periodKey, [3, 4, 5, 6, 7], opts.db, tz, ageYears);

  const baselines = pickBaselines(factsToday, "activity", ACTIVITY_METRIC_KEYS);
  const deltas = computeDeltas(
    {
      steps: activityFacts.steps ?? null,
      active_minutes: activityFacts.active_minutes ?? null,
      sedentary_minutes: activityFacts.sedentary_minutes ?? null,
      calories_kcal: activityFacts.calories_kcal ?? null,
    },
    baselines,
  );

  const cumulativeLoad7d = sumTrainingLoad(opts.db, opts.periodKey, 7, tz, ageYears);
  const cumulativeLoadBaseline7d =
    last2.length + days37.length > 0
      ? Math.round(
          [...last2, ...days37].reduce((s, d) => s + d.workout_load_total, 0) /
            (last2.length + days37.length) * 7,
        )
      : null;

  const wearSec = (factsToday?.device as { wear_seconds_24h?: number } | undefined)?.wear_seconds_24h;
  const wearH = typeof wearSec === "number" ? round1(wearSec / 3600) : null;
  const missing7 = countMissingDays(opts.insightsRoot, opts.periodKey);
  const signalIssues = collectSignalIssues(factsToday, ["activity", "cardio"]);

  const rhrDay = cardioFacts.rhr_day_bpm ?? null;
  const rhrSleep = sleepFacts.rhr_sleep_bpm ?? null;
  const rhrDrift = rhrDay != null && rhrSleep != null ? round1(rhrDay - rhrSleep) : null;

  const hrvSeries = readHrvLatest(opts.db, win.startMs as number, win.endMs as number);

  return {
    meta: {
      today_date: opts.periodKey,
      generated_at: new Date().toISOString(),
      tz,
      package_version: "activity_package/v1",
    },
    today: {
      workouts,
      steps: { total: stepsTotal > 0 ? stepsTotal : null, hourly: stepsHourly, target: STEP_TARGET_DEFAULT },
      active_minutes: activityFacts.active_minutes ?? null,
      sedentary_minutes: activityFacts.sedentary_minutes ?? null,
      sedentary_blocks: sedentaryBlocks,
      calories_kcal: activityFacts.calories_kcal ?? null,
      distance_m: activityFacts.distance_m ?? null,
      hr_5min_awake: awakeHr,
      hr_zones: hrZones,
    },
    last_2_days: last2,
    days_3_to_7: days37,
    baselines_30d: baselines,
    deltas_today: deltas,
    context: {
      last_night_sleep: pickSleepFacts(sleepFacts),
      recovery_state_today: { rhr_drift_bpm: rhrDrift, hrv_latest_ms: hrvSeries },
      cumulative_load_7d: cumulativeLoad7d,
      cumulative_load_baseline_7d: cumulativeLoadBaseline7d,
      data_quality: {
        wear_hours_today: wearH,
        missing_days_in_7d: missing7,
        signal_issues: signalIssues,
      },
    },
  };
}

function pickSleepFacts(m: Record<string, number | null>) {
  return {
    tst_min: m.tst_min ?? null,
    sleep_efficiency_pct: m.sleep_efficiency_pct ?? null,
    rmssd_ms: m.rmssd_ms ?? null,
    deep_min: m.deep_min ?? null,
  };
}

// ── Workouts ────────────────────────────────────────────────────────────────

function workoutItemToFull(item: WorkoutFactsItem): WorkoutFull {
  const endMs = new Date(item.start_iso).getTime() + item.duration_s * 1000;
  const avgSpeed =
    item.distance_m != null && item.duration_s > 0
      ? +(item.distance_m / item.duration_s).toFixed(3)
      : null;
  return {
    ts_start_iso: item.start_iso,
    ts_end_iso: new Date(endMs).toISOString(),
    kind: item.type,
    name: null,
    duration_min: Math.max(0, Math.round(item.duration_s / 60)),
    active_calories: item.calories_kcal,
    distance_m: item.distance_m,
    steps: item.steps,
    avg_speed_mps: avgSpeed,
    workout_load: item.workout_load,
    aerobic_training_effect: item.aerobic_effect,
    recovery_time_h: item.recovery_h,
    hr_avg: item.hr?.avg ?? null,
    hr_max: item.hr?.max ?? null,
    hr_min: item.hr?.min ?? null,
    hr_drift_bpm_per_min: item.hr?.drift_bpm_per_min ?? null,
    hr_zone_secs: item.hr?.zone_secs ?? null,
    dominant_hr_zone: dominantHrZone(item.hr?.zone_secs ?? null),
  };
}

function readWorkouts(
  db: Database.Database,
  win: ReturnType<typeof dayWindow>,
  ageYears: number | null,
  _tz: string,
): WorkoutFull[] {
  return queryWorkouts(db, win, ageYears).map(workoutItemToFull);
}

function sumTrainingLoad(
  db: Database.Database,
  periodKey: string,
  daysBack: number,
  tz: string,
  ageYears: number | null,
): number {
  let total = 0;
  for (let back = 0; back < daysBack; back++) {
    const win = dayWindow(shiftDateKey(periodKey, back), tz);
    const items = queryWorkouts(db, win, ageYears);
    for (const w of items) total += w.workout_load ?? 0;
  }
  return Math.round(total);
}

// ── Steps hourly ─────────────────────────────────────────────────────────────

function readStepsHourly(
  db: Database.Database,
  startMs: number,
  endMs: number,
  tz: string,
): StepsHourly[] {
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const rows = db
    .prepare<[number, number], { TIMESTAMP: number; STEPS: number }>(
      `SELECT TIMESTAMP, STEPS
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND STEPS > 0
       ORDER BY TIMESTAMP ASC`,
    )
    .all(startSec, endSec);

  const buckets = new Map<number, number>();
  for (const r of rows) {
    const localHour = msToLocalHour(r.TIMESTAMP * 1000, tz);
    buckets.set(localHour, (buckets.get(localHour) ?? 0) + r.STEPS);
  }
  const out: StepsHourly[] = [];
  for (let h = 0; h < 24; h++) {
    out.push({ hour: h, steps: buckets.get(h) ?? 0 });
  }
  return out;
}

function msToLocalHour(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

// ── Sedentary blocks ─────────────────────────────────────────────────────────

function readSedentaryBlocks(
  db: Database.Database,
  startMs: number,
  endMs: number,
): SedentaryBlock[] {
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  // Sedentary: minute rows with STEPS == 0 AND HEART_RATE present (worn).
  const rows = db
    .prepare<[number, number], { TIMESTAMP: number; STEPS: number; HEART_RATE: number | null }>(
      `SELECT TIMESTAMP, STEPS, HEART_RATE
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
       ORDER BY TIMESTAMP ASC`,
    )
    .all(startSec, endSec);

  const blocks: SedentaryBlock[] = [];
  let runStart: number | null = null;
  let runEnd: number | null = null;
  const isSedentary = (r: { STEPS: number; HEART_RATE: number | null }) =>
    r.STEPS === 0 && r.HEART_RATE != null && r.HEART_RATE > 0;

  for (const r of rows) {
    const t = r.TIMESTAMP * 1000;
    if (isSedentary(r)) {
      if (runStart == null) runStart = t;
      runEnd = t + 60_000;
    } else if (runStart != null && runEnd != null) {
      pushBlock(blocks, runStart, runEnd);
      runStart = null;
      runEnd = null;
    }
  }
  if (runStart != null && runEnd != null) pushBlock(blocks, runStart, runEnd);
  return blocks;
}

function pushBlock(out: SedentaryBlock[], startMs: number, endMs: number) {
  const durMin = Math.round((endMs - startMs) / 60_000);
  if (durMin < SEDENTARY_BLOCK_MIN_DURATION) return;
  out.push({
    start_iso: new Date(startMs).toISOString(),
    end_iso: new Date(endMs).toISOString(),
    duration_min: durMin,
  });
}

// ── Awake HR buckets + HR zones ─────────────────────────────────────────────

interface ActivityRow {
  TIMESTAMP: number;
  HEART_RATE: number | null;
}

function readAwakeHrBuckets(
  db: Database.Database,
  startMs: number,
  endMs: number,
  sleepFacts: Record<string, number | null>,
): AwakeHrBucket[] {
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const wakeMin = sleepFacts.wakeup_min ?? null;
  const bedMin = sleepFacts.bedtime_min ?? null;

  const rows = db
    .prepare<[number, number], ActivityRow>(
      `SELECT TIMESTAMP, HEART_RATE
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND HEART_RATE BETWEEN 30 AND 220
       ORDER BY TIMESTAMP ASC`,
    )
    .all(startSec, endSec);

  const filtered =
    wakeMin != null && bedMin != null
      ? rows.filter((r) => {
          const localMin = ((r.TIMESTAMP - startSec) / 60) % (24 * 60);
          if (bedMin > wakeMin) return localMin >= wakeMin && localMin < bedMin;
          return localMin >= wakeMin || localMin < bedMin;
        })
      : rows;

  return bucketBy(
    filtered,
    (r) => r.TIMESTAMP * 1000,
    (r) => r.HEART_RATE,
    HR_BUCKET_MIN * 60_000,
    (ts, vals) => ({
      ts_iso: new Date(ts).toISOString(),
      bpm_mean: Math.round(mean(vals)),
      bpm_max: Math.max(...vals),
      n_samples: vals.length,
    }),
  );
}

function computeHrZones(
  db: Database.Database,
  startMs: number,
  endMs: number,
  _sleepFacts: Record<string, number | null>,
): HrZones {
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const rows = db
    .prepare<[number, number], { HEART_RATE: number }>(
      `SELECT HEART_RATE
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND HEART_RATE BETWEEN 30 AND 220`,
    )
    .all(startSec, endSec);

  const zones: HrZones = { z1_min: 0, z2_min: 0, z3_min: 0, z4_min: 0, z5_min: 0 };
  for (const r of rows) {
    const hr = r.HEART_RATE;
    // Each row ≈ 1 minute (HUAWEI_ACTIVITY_SAMPLE is per-minute).
    if (hr < ZONE_BOUNDS.z2[0]) zones.z1_min++;
    else if (hr < ZONE_BOUNDS.z3[0]) zones.z2_min++;
    else if (hr < ZONE_BOUNDS.z4[0]) zones.z3_min++;
    else if (hr < ZONE_BOUNDS.z5[0]) zones.z4_min++;
    else zones.z5_min++;
  }
  return zones;
}

// ── HRV latest reading (for context) ─────────────────────────────────────────

function readHrvLatest(db: Database.Database, startMs: number, endMs: number): number | null {
  try {
    const row = db
      .prepare<[number, number], { VALUE: number }>(
        `SELECT VALUE
         FROM HUAWEI_HRV_VALUE_SAMPLE
         WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
           AND VALUE BETWEEN 1 AND 250
         ORDER BY TIMESTAMP DESC LIMIT 1`,
      )
      .get(startMs, endMs);
    return row?.VALUE ?? null;
  } catch {
    return null;
  }
}

// ── Neighbor activity aggregates ─────────────────────────────────────────────

function readActivityAggregates(
  insightsRoot: string,
  periodKey: string,
  daysBack: number[],
  db: Database.Database,
  tz: string,
  ageYears: number | null,
): ActivityDayAggregate[] {
  const out: ActivityDayAggregate[] = [];
  for (const back of daysBack) {
    const date = shiftDateKey(periodKey, back);
    const facts = readFactsForDate(insightsRoot, date);
    if (!facts) continue;
    const a = ((facts.activity as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
    const win = dayWindow(date, tz);
    const items = queryWorkouts(db, win, ageYears);
    out.push({
      date,
      steps: a.steps ?? null,
      active_minutes: a.active_minutes ?? null,
      sedentary_minutes: a.sedentary_minutes ?? null,
      workout_load_total: items.reduce((s, w) => s + (w.workout_load ?? 0), 0),
      workout_count: items.length,
    });
  }
  return out;
}

function countMissingDays(insightsRoot: string, periodKey: string): number {
  let missing = 0;
  for (let back = 1; back <= 7; back++) {
    const date = shiftDateKey(periodKey, back);
    const facts = readFactsForDate(insightsRoot, date);
    const wear = (facts?.device as { wear_seconds_24h?: number } | undefined)?.wear_seconds_24h;
    if (!wear || wear < 6 * 3600) missing++;
  }
  return missing;
}

function collectSignalIssues(
  facts: Record<string, unknown> | null,
  domains: string[],
): string[] {
  if (!facts) return [];
  const out: string[] = [];
  for (const d of domains) {
    const issues =
      ((facts[d] as { signal_quality?: { issues?: string[] } } | undefined)?.signal_quality
        ?.issues) ?? [];
    for (const i of issues) out.push(`${d}:${i}`);
  }
  return out;
}
