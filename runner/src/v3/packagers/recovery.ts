/**
 * Recovery use-case packager (v3).
 *
 * Reads Gadgetbridge.db for raw HRV / RHR / stress / SpO2 / awake-HR series
 * and neighbor _facts.json files for summaries + 30d baselines.
 */

import type Database from "better-sqlite3";
import { dayWindow, shiftDateKey } from "../../facts/window.ts";
import { queryWorkouts, dominantHrZone, type WorkoutFactsItem } from "../../facts/queries/workouts.ts";
import {
  bucketBy,
  computeDeltas,
  mean,
  msToLocalIso,
  pickBaselines,
  readFactsForDate,
  round1,
  type BaselineStat,
  type MetricDelta,
} from "./shared.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HrvPoint {
  ts_iso: string;
  value_ms: number;
}

export interface RhrBlock {
  rhr_day_bpm: number | null;
  rhr_sleep_bpm: number | null;
  /** day - sleep, positive = sympathetic load. */
  rhr_drift_bpm: number | null;
}

export interface StressBlock {
  mean: number | null;
  max: number | null;
  high_stress_min: number | null;
  low_stress_min: number | null;
}

export interface AwakeHrBucket {
  ts_iso: string;
  bpm_mean: number;
  bpm_min: number;
  bpm_max: number;
  n_samples: number;
}

export interface RecoveryDayAggregate {
  date: string;
  rmssd_ms: number | null;
  rhr_day_bpm: number | null;
  rhr_sleep_bpm: number | null;
  stress_mean: number | null;
  stress_max: number | null;
  sleep_quality_proxy: number | null;
}

export interface RecoveryPackage {
  meta: {
    today_date: string;
    generated_at: string;
    tz: string;
    package_version: "recovery_package/v1";
  };
  today: {
    hrv: {
      latest_rmssd_ms: number | null;
      hrv_series_today: HrvPoint[];
      rmssd_sleep_ms: number | null;
      rmssd_day_mean_ms: number | null;
    };
    rhr: RhrBlock;
    stress: StressBlock;
    spo2: { mean: number | null; min: number | null };
    hr_5min_awake: AwakeHrBucket[];
  };
  last_2_days: RecoveryDayAggregate[];
  days_3_to_7: RecoveryDayAggregate[];
  baselines_30d: Record<string, BaselineStat>;
  deltas_today: Record<string, MetricDelta>;
  context: {
    last_night_sleep: {
      tst_min: number | null;
      sleep_efficiency_pct: number | null;
      deep_min: number | null;
      rmssd_ms: number | null;
    };
    today_workouts: WorkoutLite[];
    yesterday_workouts: WorkoutLite[];
    training_load_7d: number;
    cumulative_load_baseline_7d: number | null;
    data_quality: {
      wear_hours_today: number | null;
      missing_days_in_7d: number;
      signal_issues: string[];
    };
  };
}

export interface WorkoutLite {
  ts_start_iso: string;
  ts_end_iso: string;
  kind: number;
  name: string | null;
  duration_min: number;
  workout_load: number | null;
  recovery_time_h: number | null;
  aerobic_training_effect: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  dominant_hr_zone: "z1" | "z2" | "z3" | "z4" | "z5" | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const HR_BUCKET_MIN = 5;
const RECOVERY_METRIC_KEYS_CARDIO = ["rhr_day_bpm", "hr_max_bpm", "hr_mean_bpm", "spo2_mean_pct"] as const;
const RECOVERY_METRIC_KEYS_SLEEP = ["rmssd_ms", "rhr_sleep_bpm", "spo2_min_pct"] as const;
const RECOVERY_METRIC_KEYS_STRESS = ["stress_mean", "stress_max", "high_stress_minutes"] as const;

// ── Public entry ─────────────────────────────────────────────────────────────

export interface BuildRecoveryPackageOpts {
  periodKey: string;
  db: Database.Database;
  insightsRoot: string;
  tz?: string;
}

export function buildRecoveryPackage(opts: BuildRecoveryPackageOpts): RecoveryPackage {
  const tz = opts.tz ?? "Europe/Berlin";
  const win = dayWindow(opts.periodKey, tz);
  const factsToday = readFactsForDate(opts.insightsRoot, opts.periodKey);

  // HRV series across the day (during waking + sleep, all in one).
  const hrvSeries = readHrvSeries(opts.db, win.startMs as number, win.endMs as number, tz);
  const latestRmssd = hrvSeries.length > 0 ? hrvSeries[hrvSeries.length - 1].value_ms : null;
  const rmssdDayMean =
    hrvSeries.length > 0
      ? round1(mean(hrvSeries.map((p) => p.value_ms)))
      : null;

  const sleepFacts = ((factsToday?.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
  const cardioFacts = ((factsToday?.cardio as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
  const stressFacts = ((factsToday?.stress as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};

  const rmssdSleep = sleepFacts.rmssd_ms ?? null;
  const rhrDay = cardioFacts.rhr_day_bpm ?? null;
  const rhrSleep = sleepFacts.rhr_sleep_bpm ?? null;
  const rhrDrift = rhrDay != null && rhrSleep != null ? round1(rhrDay - rhrSleep) : null;

  const awakeHr = readAwakeHrBuckets(opts.db, win.startMs as number, win.endMs as number, sleepFacts, tz);

  const last2 = readRecoveryAggregates(opts.insightsRoot, opts.periodKey, [1, 2]);
  const days37 = readRecoveryAggregates(opts.insightsRoot, opts.periodKey, [3, 4, 5, 6, 7]);

  // Baselines pulled from across cardio/sleep/stress domains, flattened by metric key.
  const baselines: Record<string, BaselineStat> = {
    ...pickBaselines(factsToday, "cardio", RECOVERY_METRIC_KEYS_CARDIO),
    ...pickBaselines(factsToday, "sleep", RECOVERY_METRIC_KEYS_SLEEP),
    ...pickBaselines(factsToday, "stress", RECOVERY_METRIC_KEYS_STRESS),
  };

  const deltas = computeDeltas(
    {
      rmssd_ms: rmssdSleep,
      rhr_day_bpm: rhrDay,
      rhr_sleep_bpm: rhrSleep,
      hr_mean_bpm: cardioFacts.hr_mean_bpm ?? null,
      spo2_mean_pct: cardioFacts.spo2_mean_pct ?? null,
      stress_mean: stressFacts.stress_mean ?? null,
      stress_max: stressFacts.stress_max ?? null,
      high_stress_minutes: stressFacts.high_stress_minutes ?? null,
    },
    baselines,
  );

  const ageYears = (factsToday?.user as { age?: number | null } | undefined)?.age ?? null;
  // Context: last night sleep + workouts (today + yesterday) + 7d training load.
  const todayWorkouts = readWorkouts(opts.db, win, ageYears, tz);
  const yWin = dayWindow(shiftDateKey(opts.periodKey, 1), tz);
  const yesterdayWorkouts = readWorkouts(opts.db, yWin, ageYears, tz);

  const trainingLoad7d = sumTrainingLoad(opts.db, opts.periodKey, 7, tz, ageYears);

  const wearSec = (factsToday?.device as { wear_seconds_24h?: number } | undefined)?.wear_seconds_24h;
  const wearH = typeof wearSec === "number" ? round1(wearSec / 3600) : null;
  const missing7 = countMissingDays(opts.insightsRoot, opts.periodKey);
  const signalIssues = collectSignalIssues(factsToday, ["cardio", "stress", "sleep"]);

  return {
    meta: {
      today_date: opts.periodKey,
      generated_at: new Date().toISOString(),
      tz,
      package_version: "recovery_package/v1",
    },
    today: {
      hrv: {
        latest_rmssd_ms: latestRmssd,
        hrv_series_today: hrvSeries,
        rmssd_sleep_ms: rmssdSleep,
        rmssd_day_mean_ms: rmssdDayMean,
      },
      rhr: { rhr_day_bpm: rhrDay, rhr_sleep_bpm: rhrSleep, rhr_drift_bpm: rhrDrift },
      stress: {
        mean: stressFacts.stress_mean ?? null,
        max: stressFacts.stress_max ?? null,
        high_stress_min: stressFacts.high_stress_minutes ?? null,
        low_stress_min: stressFacts.low_stress_minutes ?? null,
      },
      spo2: {
        mean: cardioFacts.spo2_mean_pct ?? null,
        min: sleepFacts.spo2_min_pct ?? null,
      },
      hr_5min_awake: awakeHr,
    },
    last_2_days: last2,
    days_3_to_7: days37,
    baselines_30d: baselines,
    deltas_today: deltas,
    context: {
      last_night_sleep: {
        tst_min: sleepFacts.tst_min ?? null,
        sleep_efficiency_pct: sleepFacts.sleep_efficiency_pct ?? null,
        deep_min: sleepFacts.deep_min ?? null,
        rmssd_ms: sleepFacts.rmssd_ms ?? null,
      },
      today_workouts: todayWorkouts,
      yesterday_workouts: yesterdayWorkouts,
      training_load_7d: trainingLoad7d,
      cumulative_load_baseline_7d: null,
      data_quality: {
        wear_hours_today: wearH,
        missing_days_in_7d: missing7,
        signal_issues: signalIssues,
      },
    },
  };
}

// ── HRV series ───────────────────────────────────────────────────────────────

function readHrvSeries(
  db: Database.Database,
  startMs: number,
  endMs: number,
  tz: string,
): HrvPoint[] {
  const rows = db
    .prepare<[number, number], { TIMESTAMP: number; VALUE: number }>(
      `SELECT TIMESTAMP, VALUE
       FROM HUAWEI_HRV_VALUE_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND VALUE BETWEEN 1 AND 250
       ORDER BY TIMESTAMP ASC`,
    )
    .all(startMs, endMs);
  return rows.map((r) => ({
    ts_iso: msToLocalIso(r.TIMESTAMP, tz),
    value_ms: r.VALUE,
  }));
}

// ── Awake HR buckets ─────────────────────────────────────────────────────────

interface ActivityRow {
  TIMESTAMP: number;
  HEART_RATE: number | null;
}

function readAwakeHrBuckets(
  db: Database.Database,
  startMs: number,
  endMs: number,
  sleepFacts: Record<string, number | null>,
  tz: string,
): AwakeHrBucket[] {
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  // Awake = full day window minus sleep window. Easiest approximation: pick rows
  // whose TIMESTAMP local-hour falls between wakeup_min..bedtime_min(+24h).
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

  // Filter to awake window. If we don't know bed/wake, pass everything through.
  const filtered =
    wakeMin != null && bedMin != null
      ? rows.filter((r) => {
          const localMin = ((r.TIMESTAMP - startSec) / 60) % (24 * 60);
          // Awake: from wakeMin to (bedMin if bedMin > wakeMin, else end of day).
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
      ts_iso: msToLocalIso(ts, tz),
      bpm_mean: Math.round(mean(vals)),
      bpm_min: Math.min(...vals),
      bpm_max: Math.max(...vals),
      n_samples: vals.length,
    }),
  );
}

// ── Workouts ────────────────────────────────────────────────────────────────

function workoutItemToLite(item: WorkoutFactsItem, tz: string): WorkoutLite {
  const startMs = new Date(item.start_iso).getTime();
  const endMs = startMs + item.duration_s * 1000;
  return {
    ts_start_iso: msToLocalIso(startMs, tz),
    ts_end_iso: msToLocalIso(endMs, tz),
    kind: item.type,
    name: null,
    duration_min: Math.max(0, Math.round(item.duration_s / 60)),
    workout_load: item.workout_load,
    recovery_time_h: item.recovery_h,
    aerobic_training_effect: item.aerobic_effect,
    hr_avg: item.hr?.avg ?? null,
    hr_max: item.hr?.max ?? null,
    dominant_hr_zone: dominantHrZone(item.hr?.zone_secs ?? null),
  };
}

function readWorkouts(
  db: Database.Database,
  win: ReturnType<typeof dayWindow>,
  ageYears: number | null,
  tz: string,
): WorkoutLite[] {
  return queryWorkouts(db, win, ageYears).map((item) => workoutItemToLite(item, tz));
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

// ── Neighbor recovery aggregates ─────────────────────────────────────────────

function readRecoveryAggregates(
  insightsRoot: string,
  periodKey: string,
  daysBack: number[],
): RecoveryDayAggregate[] {
  const out: RecoveryDayAggregate[] = [];
  for (const back of daysBack) {
    const date = shiftDateKey(periodKey, back);
    const facts = readFactsForDate(insightsRoot, date);
    if (!facts) continue;
    const sleep = ((facts.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
    const cardio = ((facts.cardio as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
    const stress = ((facts.stress as { metrics?: Record<string, number | null> } | undefined)?.metrics) ?? {};
    const tst = sleep.tst_min ?? null;
    const eff = sleep.sleep_efficiency_pct ?? null;
    // Sleep quality proxy: simple eff × tst hours / 8h. Cap at 100.
    const sleepQuality =
      tst != null && eff != null ? Math.min(100, Math.round(eff * (tst / 480))) : null;
    out.push({
      date,
      rmssd_ms: sleep.rmssd_ms ?? null,
      rhr_day_bpm: cardio.rhr_day_bpm ?? null,
      rhr_sleep_bpm: sleep.rhr_sleep_bpm ?? null,
      stress_mean: stress.stress_mean ?? null,
      stress_max: stress.stress_max ?? null,
      sleep_quality_proxy: sleepQuality,
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
