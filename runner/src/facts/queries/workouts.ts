/**
 * Workout facts — per-workout summary + HR aggregates.
 *
 * Source tables: HUAWEI_WORKOUT_SUMMARY_SAMPLE (one row per workout, seconds
 * epoch) and HUAWEI_WORKOUT_DATA_SAMPLE (per-second samples). Both are
 * Huawei-specific. The Garmin-style BASE_ACTIVITY_SUMMARY is intentionally
 * not consulted here — this is a Huawei-only deployment.
 *
 * HR overflow rule applies: Huawei signed-byte storage means a raw negative
 * value `< -1` is really `256 + raw`. Applied per sample before the validity
 * gate.
 *
 * Zone model: %HRmax bins. HRmax derived from `ageYears` (220 − age) or a
 * static fallback when age is null. Each sample ≈ 1 second.
 *
 * Drift: (avg of last quartile) − (avg of first quartile), normalised to
 * bpm/min. Returns null when fewer than 8 valid samples or zero duration.
 */

import type Database from "better-sqlite3";
import type { DayWindow } from "../window.ts";

const HRMAX_FALLBACK = 185;
const HR_VALID_LOW = 30;
const HR_VALID_HIGH = 220;
const MIN_VALID_SAMPLES = 8;

export interface WorkoutHRStats {
  avg: number | null;
  max: number | null;
  min: number | null;
  samples: number;
  zone_secs: { z1: number; z2: number; z3: number; z4: number; z5: number };
  drift_bpm_per_min: number | null;
}

export interface WorkoutFactsItem {
  id: number;
  type: number;
  start_iso: string;
  duration_s: number;
  distance_m: number | null;
  steps: number | null;
  calories_kcal: number | null;
  workout_load: number | null;
  aerobic_effect: number | null;
  recovery_h: number | null;
  hr: WorkoutHRStats | null;
}

interface SummaryRow {
  WORKOUT_ID: number;
  TYPE: number;
  START_TIMESTAMP: number;
  END_TIMESTAMP: number;
  DURATION: number;
  DISTANCE: number | null;
  STEP_COUNT: number | null;
  CALORIES: number | null;
  WORKOUT_LOAD: number | null;
  WORKOUT_AEROBIC_EFFECT: number | null;
  RECOVERY_TIME: number | null;
}

interface DataRow {
  TIMESTAMP: number;
  HEART_RATE: number;
}

function correctHr(raw: number): number | null {
  const v = raw < 0 && raw !== -1 ? 256 + raw : raw;
  return v > HR_VALID_LOW && v < HR_VALID_HIGH ? v : null;
}

function zoneForHr(hr: number, hrMax: number): keyof WorkoutHRStats["zone_secs"] {
  const pct = hr / hrMax;
  if (pct < 0.6) return "z1";
  if (pct < 0.7) return "z2";
  if (pct < 0.8) return "z3";
  if (pct < 0.9) return "z4";
  return "z5";
}

function computeHRStats(
  db: Database.Database,
  workoutId: number,
  durationSec: number,
  ageYears: number | null,
): WorkoutHRStats | null {
  let rows: DataRow[];
  try {
    rows = db
      .prepare<[number], DataRow>(
        `SELECT TIMESTAMP, HEART_RATE
         FROM HUAWEI_WORKOUT_DATA_SAMPLE
         WHERE WORKOUT_ID = ?
         ORDER BY TIMESTAMP ASC`,
      )
      .all(workoutId);
  } catch {
    return null;
  }

  const hrMax =
    ageYears != null && Number.isFinite(ageYears)
      ? 220 - Math.round(ageYears)
      : HRMAX_FALLBACK;

  const valid: number[] = [];
  const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;

  for (const r of rows) {
    const hr = correctHr(r.HEART_RATE);
    if (hr === null) continue;
    valid.push(hr);
    sum += hr;
    if (hr > max) max = hr;
    if (hr < min) min = hr;
    zones[zoneForHr(hr, hrMax)]++;
  }

  if (valid.length < MIN_VALID_SAMPLES || durationSec <= 0) return null;

  const avg = sum / valid.length;
  // Quartile-difference drift. Each valid sample ≈ 1 second; spread across
  // workout duration produces a bpm/min slope.
  const q = Math.floor(valid.length / 4);
  let drift: number | null = null;
  if (q >= 2) {
    const firstQ = valid.slice(0, q);
    const lastQ = valid.slice(valid.length - q);
    const firstAvg = firstQ.reduce((a, b) => a + b, 0) / firstQ.length;
    const lastAvg = lastQ.reduce((a, b) => a + b, 0) / lastQ.length;
    drift = +((lastAvg - firstAvg) / (durationSec / 60)).toFixed(2);
  }

  return {
    avg: +avg.toFixed(1),
    max,
    min,
    samples: valid.length,
    zone_secs: zones,
    drift_bpm_per_min: drift,
  };
}

export function queryWorkouts(
  db: Database.Database,
  win: DayWindow,
  ageYears: number | null,
): WorkoutFactsItem[] {
  let summaries: SummaryRow[];
  try {
    summaries = db
      .prepare<[number, number], SummaryRow>(
        `SELECT WORKOUT_ID, TYPE, START_TIMESTAMP, END_TIMESTAMP, DURATION,
                DISTANCE, STEP_COUNT, CALORIES,
                WORKOUT_LOAD, WORKOUT_AEROBIC_EFFECT, RECOVERY_TIME
         FROM HUAWEI_WORKOUT_SUMMARY_SAMPLE
         WHERE START_TIMESTAMP >= ? AND START_TIMESTAMP < ?
         ORDER BY START_TIMESTAMP ASC`,
      )
      .all(win.startSec as number, win.endSec as number);
  } catch {
    return [];
  }

  const items: WorkoutFactsItem[] = [];
  for (const s of summaries) {
    const hr = computeHRStats(db, s.WORKOUT_ID, s.DURATION, ageYears);
    const aerobic =
      s.WORKOUT_AEROBIC_EFFECT != null && s.WORKOUT_AEROBIC_EFFECT > 0
        ? +(s.WORKOUT_AEROBIC_EFFECT / 10).toFixed(1)
        : null;
    const recoveryH =
      s.RECOVERY_TIME != null && s.RECOVERY_TIME > 0
        ? +(s.RECOVERY_TIME / 60).toFixed(1)
        : null;
    items.push({
      id: s.WORKOUT_ID,
      type: s.TYPE,
      start_iso: new Date(s.START_TIMESTAMP * 1000).toISOString(),
      duration_s: s.DURATION,
      distance_m: s.DISTANCE != null && s.DISTANCE > 0 ? s.DISTANCE : null,
      steps: s.STEP_COUNT != null && s.STEP_COUNT > 0 ? s.STEP_COUNT : null,
      calories_kcal: s.CALORIES != null && s.CALORIES > 0 ? s.CALORIES : null,
      workout_load: s.WORKOUT_LOAD ?? null,
      aerobic_effect: aerobic,
      recovery_h: recoveryH,
      hr,
    });
  }
  return items;
}

/** Dominant HR zone by seconds. Null when zone_secs is null or all-zero. */
export function dominantHrZone(
  zoneSecs: WorkoutHRStats["zone_secs"] | null,
): "z1" | "z2" | "z3" | "z4" | "z5" | null {
  if (!zoneSecs) return null;
  const entries = Object.entries(zoneSecs) as Array<[
    "z1" | "z2" | "z3" | "z4" | "z5",
    number,
  ]>;
  let best: "z1" | "z2" | "z3" | "z4" | "z5" | null = null;
  let bestVal = 0;
  for (const [k, v] of entries) {
    if (v > bestVal) {
      bestVal = v;
      best = k;
    }
  }
  return best;
}
