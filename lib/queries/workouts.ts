import "server-only";
import { db } from "../db";
import { sportName } from "../workouts/sport-names";

/**
 * HUAWEI_WORKOUT_* schema (verified against the live DB).
 *
 *   - HUAWEI_WORKOUT_SUMMARY_SAMPLE.{START,END}_TIMESTAMP are SECONDS
 *     (decoded from device-side seconds-epoch). Other Huawei tables
 *     (sleep, apnea, stage) are milliseconds — workout is the exception.
 *   - HUAWEI_WORKOUT_DATA_SAMPLE.TIMESTAMP is also seconds; rows are roughly
 *     once per second during the workout (varies by sport).
 *   - DISTANCE is meters, DURATION is seconds, CALORIES is integer kcal.
 *   - WORKOUT_AEROBIC_EFFECT / WORKOUT_ANAEROBIC_EFFECT are scaled ×10
 *     (e.g. value 34 → 3.4 on the typical 0..5 effect scale).
 *   - MAX_MET is integer — when nonzero acts as a VO2-proxy: VO2max ≈
 *     value × 0.0035 mL/kg/min isn't accurate, so we surface MET directly
 *     (1 MET = 3.5 mL/kg/min resting baseline).
 *   - RUN_PACE_ZONE{1..5}_TIME are seconds-in-zone for runs.
 *
 * The WORKOUT table family is corrupt-tolerant on this device — read paths
 * wrap try/catch so a partial DB doesn't crash the page.
 */

export const WORKOUT_TYPES: Record<number, { label: string; icon: string }> = {
  1:  { label: "Gehen",         icon: "Footprints" },
  2:  { label: "Laufen",        icon: "Footprints" },
  3:  { label: "Radfahren",     icon: "Activity"   },
  4:  { label: "Laufen",        icon: "Footprints" },
  5:  { label: "Laufband",      icon: "Footprints" },
  6:  { label: "Indoor-Rad",    icon: "Activity"   },
  8:  { label: "Schwimmen",     icon: "Waves"      },
  13: { label: "Wandern",       icon: "Mountain"   },
  16: { label: "Krafttraining", icon: "Dumbbell"   },
  17: { label: "Yoga",          icon: "Sparkles"   },
  18: { label: "Sonstige",      icon: "Activity"   },
};

export function workoutTypeLabel(t: number): string {
  return WORKOUT_TYPES[t]?.label ?? sportName(t);
}

export function workoutTypeIcon(t: number): string {
  return WORKOUT_TYPES[t]?.icon ?? "Activity";
}

/**
 * Heuristic re-classification when device-reported TYPE is "run" but the
 * pace + elevation profile clearly indicate hiking or walking.
 *
 * Why: the Huawei watch defaults outdoor sessions to TYPE=4 (Outdoor Run)
 * even when the user opens hiking. A 6 km, 2 h, +6800 m / -779 m session
 * isn't running.
 *
 * Returns the inferred {label, icon, type} where `type` is the *display*
 * type code (13 = Wandern, 1 = Gehen). The DB row is left untouched.
 */
function paceKmh(distanceM: number, durationSec: number): number | null {
  if (durationSec <= 0 || distanceM <= 0) return null;
  return (distanceM / 1000) / (durationSec / 3600);
}

function ascentRatio(elevationGain: number | null, distanceM: number): number {
  if (elevationGain == null || elevationGain <= 0 || distanceM <= 0) return 0;
  // gain per km
  return elevationGain / (distanceM / 1000);
}

export function classifyWorkout(opts: {
  type: number;
  distanceM: number;
  durationSec: number;
  elevationGain: number | null;
}): { type: number; label: string; icon: string; reclassified: boolean } {
  const orig = WORKOUT_TYPES[opts.type] ?? { label: sportName(opts.type), icon: "Activity" };
  // Only reclassify when device says outdoor-run-ish.
  if (opts.type !== 2 && opts.type !== 4) {
    return { type: opts.type, label: orig.label, icon: orig.icon, reclassified: false };
  }
  const pace = paceKmh(opts.distanceM, opts.durationSec);
  const ratio = ascentRatio(opts.elevationGain, opts.distanceM);
  if (pace == null) {
    return { type: opts.type, label: orig.label, icon: orig.icon, reclassified: false };
  }
  // Hiking: slow pace AND meaningful climb (≥40 m/km).
  if (pace < 6.5 && ratio >= 40) {
    return { type: 13, label: WORKOUT_TYPES[13].label, icon: WORKOUT_TYPES[13].icon, reclassified: true };
  }
  // Walking: slow pace, flat-ish.
  if (pace < 5.5) {
    return { type: 1, label: WORKOUT_TYPES[1].label, icon: WORKOUT_TYPES[1].icon, reclassified: true };
  }
  return { type: opts.type, label: orig.label, icon: orig.icon, reclassified: false };
}

export type WorkoutSummary = {
  id: number;
  type: number;            // effective (after reclassification heuristic)
  rawType: number;         // device-reported original
  reclassified: boolean;
  typeLabel: string;
  typeIcon: string;
  startTs: number;        // seconds
  endTs: number;          // seconds
  durationSec: number;
  distanceM: number;
  steps: number;
  calories: number;
  hrMin: number | null;
  hrMax: number | null;
  altitudeMin: number | null;
  altitudeMax: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  workoutLoad: number | null;
  aerobicEffect: number | null;     // 0..5 scale (descaled ×0.1)
  anaerobicEffect: number | null;   // 0..5 scale
  recoveryHours: number | null;
  maxMet: number | null;            // 0 means unset
  paceZoneSeconds: [number, number, number, number, number] | null;
  trainingPoints: number | null;
  hasGpx: boolean;
  /** Phone-side GPX path from device (Android filesystem; not directly readable on Mac/Pi). */
  gpxPath: string | null;
};

const SUMMARY_COLUMNS = `
  WORKOUT_ID, TYPE, START_TIMESTAMP, END_TIMESTAMP, DURATION,
  DISTANCE, STEP_COUNT, CALORIES,
  MIN_HEART_RATE_PEAK, MAX_HEART_RATE_PEAK,
  MIN_ALTITUDE, MAX_ALTITUDE, ELEVATION_GAIN, ELEVATION_LOSS,
  WORKOUT_LOAD, WORKOUT_AEROBIC_EFFECT, WORKOUT_ANAEROBIC_EFFECT,
  RECOVERY_TIME, MAX_MET,
  RUN_PACE_ZONE1_TIME, RUN_PACE_ZONE2_TIME, RUN_PACE_ZONE3_TIME,
  RUN_PACE_ZONE4_TIME, RUN_PACE_ZONE5_TIME,
  TRAINING_POINTS, GPX_FILE_LOCATION
`.trim();

type SummaryRow = {
  WORKOUT_ID: number;
  TYPE: number;
  START_TIMESTAMP: number;
  END_TIMESTAMP: number;
  DURATION: number;
  DISTANCE: number;
  STEP_COUNT: number;
  CALORIES: number;
  MIN_HEART_RATE_PEAK: number | null;
  MAX_HEART_RATE_PEAK: number | null;
  MIN_ALTITUDE: number | null;
  MAX_ALTITUDE: number | null;
  ELEVATION_GAIN: number | null;
  ELEVATION_LOSS: number | null;
  WORKOUT_LOAD: number | null;
  WORKOUT_AEROBIC_EFFECT: number | null;
  WORKOUT_ANAEROBIC_EFFECT: number | null;
  RECOVERY_TIME: number | null;
  MAX_MET: number | null;
  RUN_PACE_ZONE1_TIME: number | null;
  RUN_PACE_ZONE2_TIME: number | null;
  RUN_PACE_ZONE3_TIME: number | null;
  RUN_PACE_ZONE4_TIME: number | null;
  RUN_PACE_ZONE5_TIME: number | null;
  TRAINING_POINTS: number | null;
  GPX_FILE_LOCATION: string | null;
};

function rowToSummary(r: SummaryRow): WorkoutSummary {
  // Heart-rate peaks: device occasionally writes negatives or zeros when
  // the sensor disconnected; map invalid values to null.
  const hrMin = r.MIN_HEART_RATE_PEAK != null && r.MIN_HEART_RATE_PEAK > 30 && r.MIN_HEART_RATE_PEAK < 220
    ? r.MIN_HEART_RATE_PEAK : null;
  const hrMax = r.MAX_HEART_RATE_PEAK != null && r.MAX_HEART_RATE_PEAK > 30 && r.MAX_HEART_RATE_PEAK < 220
    ? r.MAX_HEART_RATE_PEAK : null;
  const ae = r.WORKOUT_AEROBIC_EFFECT != null && r.WORKOUT_AEROBIC_EFFECT > 0
    ? +(r.WORKOUT_AEROBIC_EFFECT / 10).toFixed(1) : null;
  const ane = r.WORKOUT_ANAEROBIC_EFFECT != null && r.WORKOUT_ANAEROBIC_EFFECT > 0
    ? +(r.WORKOUT_ANAEROBIC_EFFECT / 10).toFixed(1) : null;
  // Recovery_time is in minutes per Huawei convention; convert to hours.
  const recoveryHours = r.RECOVERY_TIME != null && r.RECOVERY_TIME > 0
    ? +(r.RECOVERY_TIME / 60).toFixed(1) : null;
  const paceZones: [number, number, number, number, number] = [
    r.RUN_PACE_ZONE1_TIME ?? 0,
    r.RUN_PACE_ZONE2_TIME ?? 0,
    r.RUN_PACE_ZONE3_TIME ?? 0,
    r.RUN_PACE_ZONE4_TIME ?? 0,
    r.RUN_PACE_ZONE5_TIME ?? 0,
  ];
  const hasPaceData = paceZones.some((v) => v > 0);
  const cls = classifyWorkout({
    type: r.TYPE,
    distanceM: r.DISTANCE,
    durationSec: r.DURATION,
    elevationGain: r.ELEVATION_GAIN,
  });
  return {
    id: r.WORKOUT_ID,
    type: cls.type,
    rawType: r.TYPE,
    reclassified: cls.reclassified,
    typeLabel: cls.label,
    typeIcon: cls.icon,
    startTs: r.START_TIMESTAMP,
    endTs: r.END_TIMESTAMP,
    durationSec: r.DURATION,
    distanceM: r.DISTANCE,
    steps: r.STEP_COUNT,
    calories: r.CALORIES,
    hrMin,
    hrMax,
    altitudeMin: r.MIN_ALTITUDE,
    altitudeMax: r.MAX_ALTITUDE,
    elevationGain: r.ELEVATION_GAIN,
    elevationLoss: r.ELEVATION_LOSS,
    workoutLoad: r.WORKOUT_LOAD ?? null,
    aerobicEffect: ae,
    anaerobicEffect: ane,
    recoveryHours,
    maxMet: r.MAX_MET != null && r.MAX_MET > 0 ? r.MAX_MET : null,
    paceZoneSeconds: hasPaceData ? paceZones : null,
    trainingPoints: r.TRAINING_POINTS ?? null,
    hasGpx: !!r.GPX_FILE_LOCATION,
    gpxPath: r.GPX_FILE_LOCATION ?? null,
  };
}

/** All workouts in the given UNIX-second window, newest first. */
export function getWorkouts(opts?: { sinceSec?: number; untilSec?: number; limit?: number }): WorkoutSummary[] {
  const where: string[] = [];
  const params: number[] = [];
  if (opts?.sinceSec) {
    where.push("START_TIMESTAMP >= ?");
    params.push(opts.sinceSec);
  }
  if (opts?.untilSec) {
    where.push("START_TIMESTAMP < ?");
    params.push(opts.untilSec);
  }
  const limit = opts?.limit ?? 200;
  const sql = `SELECT ${SUMMARY_COLUMNS}
               FROM HUAWEI_WORKOUT_SUMMARY_SAMPLE
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY START_TIMESTAMP DESC
               LIMIT ${limit}`;
  try {
    const rows = db().prepare<number[], SummaryRow>(sql).all(...params);
    return rows.map(rowToSummary);
  } catch {
    return [];
  }
}

export function getWorkoutById(id: number): WorkoutSummary | null {
  try {
    const r = db()
      .prepare<[number], SummaryRow>(
        `SELECT ${SUMMARY_COLUMNS}
         FROM HUAWEI_WORKOUT_SUMMARY_SAMPLE
         WHERE WORKOUT_ID = ?`,
      )
      .get(id);
    return r ? rowToSummary(r) : null;
  } catch {
    return null;
  }
}

export type WorkoutDataPoint = {
  ts: number;     // seconds
  hr: number | null;
  speedDmS: number | null;     // device emits speed in dm/s; convert with /10 for m/s
  cadence: number | null;
  altitude: number | null;
  cyclingPower: number | null;
  spo2: number | null;
  temp: number | null;
};

/** Per-second samples for a single workout. */
export function getWorkoutData(workoutId: number, limit = 5000): WorkoutDataPoint[] {
  try {
    const rows = db()
      .prepare<
        [number],
        {
          TIMESTAMP: number;
          HEART_RATE: number;
          SPEED: number;
          CADENCE: number;
          ALTITUDE: number | null;
          CYCLING_POWER: number;
          SPO2: number;
          TEMP: number;
        }
      >(
        `SELECT TIMESTAMP, HEART_RATE, SPEED, CADENCE, ALTITUDE, CYCLING_POWER, SPO2, TEMP
         FROM HUAWEI_WORKOUT_DATA_SAMPLE
         WHERE WORKOUT_ID = ?
         ORDER BY TIMESTAMP ASC
         LIMIT ${limit}`,
      )
      .all(workoutId);
    return rows.map((r) => {
      // Huawei signed-byte overflow: raw < -1 ⇒ real bpm = 256 + raw.
      const rawHr = r.HEART_RATE;
      const corrected = rawHr < 0 && rawHr !== -1 ? 256 + rawHr : rawHr;
      return ({
      ts: r.TIMESTAMP,
      hr: corrected > 30 && corrected < 220 ? corrected : null,
      speedDmS: r.SPEED > 0 ? r.SPEED : null,
      cadence: r.CADENCE > 0 ? r.CADENCE : null,
      altitude: r.ALTITUDE != null && r.ALTITUDE !== 0 ? r.ALTITUDE : null,
      cyclingPower: r.CYCLING_POWER > 0 ? r.CYCLING_POWER : null,
      spo2: r.SPO2 > 50 && r.SPO2 <= 100 ? r.SPO2 : null,
      temp: r.TEMP > 0 ? r.TEMP : null,
      });
    });
  } catch {
    return [];
  }
}

/**
 * Aggregate HR stats for one workout: avg/max/min, time-in-zone (%HRmax bins),
 * and cardiac drift (quartile difference, bpm/min). Mirrors the runner's
 * shape (`runner/src/facts/queries/workouts.ts`) so callers can interleave
 * data from facts vs. live queries without conversion.
 *
 * `ageYears` derives HRmax via `220 - age`; pass `facts.user.age` when known.
 * Falls back to 185 when null. Returns null when fewer than 8 valid samples.
 */
export type HrZoneKey = "z1" | "z2" | "z3" | "z4" | "z5";

export type WorkoutHRStats = {
  avg: number | null;
  max: number | null;
  min: number | null;
  samples: number;
  zone_secs: Record<HrZoneKey, number>;
  drift_bpm_per_min: number | null;
};

const HRMAX_FALLBACK = 185;

function zoneForHr(hr: number, hrMax: number): HrZoneKey {
  const pct = hr / hrMax;
  if (pct < 0.6) return "z1";
  if (pct < 0.7) return "z2";
  if (pct < 0.8) return "z3";
  if (pct < 0.9) return "z4";
  return "z5";
}

export function getWorkoutHRStats(
  workoutId: number,
  ageYears: number | null = null,
): WorkoutHRStats | null {
  const data = getWorkoutData(workoutId);
  if (data.length === 0) return null;

  const hrMax =
    ageYears != null && Number.isFinite(ageYears)
      ? 220 - Math.round(ageYears)
      : HRMAX_FALLBACK;

  const valid: number[] = [];
  const zones: Record<HrZoneKey, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const d of data) {
    if (d.hr == null) continue;
    valid.push(d.hr);
    sum += d.hr;
    if (d.hr > max) max = d.hr;
    if (d.hr < min) min = d.hr;
    zones[zoneForHr(d.hr, hrMax)]++;
  }

  if (valid.length < 8) return null;

  const first = data[0].ts;
  const last = data[data.length - 1].ts;
  const durationSec = Math.max(0, last - first);

  let drift: number | null = null;
  const q = Math.floor(valid.length / 4);
  if (q >= 2 && durationSec > 0) {
    const firstQ = valid.slice(0, q);
    const lastQ = valid.slice(valid.length - q);
    const fa = firstQ.reduce((a, b) => a + b, 0) / firstQ.length;
    const la = lastQ.reduce((a, b) => a + b, 0) / lastQ.length;
    drift = +((la - fa) / (durationSec / 60)).toFixed(2);
  }

  return {
    avg: +(sum / valid.length).toFixed(1),
    max,
    min,
    samples: valid.length,
    zone_secs: zones,
    drift_bpm_per_min: drift,
  };
}

export function dominantHrZone(zoneSecs: Record<HrZoneKey, number> | null): HrZoneKey | null {
  if (!zoneSecs) return null;
  let best: HrZoneKey | null = null;
  let bestVal = 0;
  for (const k of ["z1", "z2", "z3", "z4", "z5"] as HrZoneKey[]) {
    if (zoneSecs[k] > bestVal) {
      bestVal = zoneSecs[k];
      best = k;
    }
  }
  return best;
}

export type WorkoutSection = {
  num: number;
  timeSec: number;
  distanceM: number;
  paceSecPerKm: number | null;
  hr: number | null;
  cadence: number | null;
};

export function getWorkoutSections(workoutId: number): WorkoutSection[] {
  try {
    const rows = db()
      .prepare<
        [number],
        {
          NUM: number;
          TIME: number;
          DISTANCE: number;
          PACE: number;
          HEART_RATE: number;
          CADENCE: number;
        }
      >(
        `SELECT NUM, TIME, DISTANCE, PACE, HEART_RATE, CADENCE
         FROM HUAWEI_WORKOUT_SECTIONS_SAMPLE
         WHERE WORKOUT_ID = ?
         ORDER BY NUM ASC`,
      )
      .all(workoutId);
    return rows.map((r) => ({
      num: r.NUM,
      timeSec: r.TIME,
      distanceM: r.DISTANCE,
      paceSecPerKm: r.PACE > 0 ? r.PACE : null,
      hr: r.HEART_RATE > 30 && r.HEART_RATE < 220 ? r.HEART_RATE : null,
      cadence: r.CADENCE > 0 ? r.CADENCE : null,
    }));
  } catch {
    return [];
  }
}

/**
 * GPS samples emitted by Colmi MF / CMF-family watches into
 * `CMF_WORKOUT_GPS_SAMPLE`. Lat/Lon are stored as integers; Gadgetbridge
 * convention is microdegrees (×1e6) but we tolerate the alternate ×1e7
 * scaling by inspecting magnitude. Empty for Huawei devices (their GPS
 * lives in GPX files on the phone instead — see lib/queries/gpx.ts).
 *
 * `TIMESTAMP` is milliseconds (consistent with other CMF tables).
 */
export type GpsPoint = { ts: number; lat: number; lon: number };

export function getCmfGpsSamples(opts: { sinceSec?: number; untilSec?: number }): GpsPoint[] {
  const where: string[] = [];
  const params: number[] = [];
  if (opts.sinceSec != null) {
    where.push("TIMESTAMP >= ?");
    params.push(opts.sinceSec * 1000);
  }
  if (opts.untilSec != null) {
    where.push("TIMESTAMP < ?");
    params.push(opts.untilSec * 1000);
  }
  const sql = `SELECT TIMESTAMP, LATITUDE, LONGITUDE
               FROM CMF_WORKOUT_GPS_SAMPLE
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY TIMESTAMP ASC`;
  try {
    const rows = db()
      .prepare<number[], { TIMESTAMP: number; LATITUDE: number | null; LONGITUDE: number | null }>(sql)
      .all(...params);
    const out: GpsPoint[] = [];
    for (const r of rows) {
      if (r.LATITUDE == null || r.LONGITUDE == null) continue;
      const lat = scaleCoord(r.LATITUDE);
      const lon = scaleCoord(r.LONGITUDE);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      out.push({ ts: r.TIMESTAMP, lat, lon });
    }
    return out;
  } catch {
    return [];
  }
}

function scaleCoord(raw: number): number {
  const abs = Math.abs(raw);
  if (abs >= 1e8) return raw / 1e7;   // ×1e7 storage
  if (abs >= 1e4) return raw / 1e6;   // ×1e6 storage (default)
  return raw;                          // already in degrees
}

/**
 * Acute training-load timeseries. Acute = 7-day exponentially-weighted
 * sum of workout loads. Chronic = 28-day. ACWR = acute / chronic — the
 * sweet spot is roughly 0.8..1.3 (deconditioning < 0.8, injury risk > 1.5).
 *
 * Tables are written by Garmin-style devices; on Huawei they may be empty.
 * The query returns [] in that case so the UI renders an empty state.
 */
export type LoadPoint = { dateKey: string; value: number };

export function getTrainingLoadAcute(opts?: { sinceSec?: number; untilSec?: number }): LoadPoint[] {
  return readLoadSeries("GENERIC_TRAINING_LOAD_ACUTE_SAMPLE", opts);
}

export function getTrainingLoadChronic(opts?: { sinceSec?: number; untilSec?: number }): LoadPoint[] {
  return readLoadSeries("GENERIC_TRAINING_LOAD_CHRONIC_SAMPLE", opts);
}

function readLoadSeries(
  table: string,
  opts?: { sinceSec?: number; untilSec?: number },
): LoadPoint[] {
  const where: string[] = [];
  const params: number[] = [];
  if (opts?.sinceSec) {
    where.push("TIMESTAMP >= ?");
    params.push(opts.sinceSec * 1000);
  }
  if (opts?.untilSec) {
    where.push("TIMESTAMP < ?");
    params.push(opts.untilSec * 1000);
  }
  const sql = `SELECT TIMESTAMP, VALUE
               FROM ${table}
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY TIMESTAMP ASC`;
  try {
    const rows = db()
      .prepare<number[], { TIMESTAMP: number; VALUE: number }>(sql)
      .all(...params);
    return rows.map((r) => ({
      dateKey: new Date(r.TIMESTAMP).toISOString().slice(0, 10),
      value: r.VALUE,
    }));
  } catch {
    return [];
  }
}

/**
 * ACWR snapshot at the latest available pair. Returns null if either
 * series is empty or chronic is zero.
 */
export function getAcwrSnapshot(): {
  acute: number;
  chronic: number;
  ratio: number;
  band: "deconditioning" | "optimal" | "high" | "very_high";
  date: string;
} | null {
  const acute = getTrainingLoadAcute();
  const chronic = getTrainingLoadChronic();
  if (acute.length === 0 || chronic.length === 0) return null;
  const lastAcute = acute[acute.length - 1];
  const lastChronic = chronic[chronic.length - 1];
  if (lastChronic.value === 0) return null;
  const ratio = lastAcute.value / lastChronic.value;
  const band: "deconditioning" | "optimal" | "high" | "very_high" =
    ratio < 0.8 ? "deconditioning"
    : ratio <= 1.3 ? "optimal"
    : ratio <= 1.5 ? "high"
    : "very_high";
  return {
    acute: lastAcute.value,
    chronic: lastChronic.value,
    ratio: +ratio.toFixed(2),
    band,
    date: lastAcute.dateKey,
  };
}
