/** Domain types. Server-side computed, client-safe (plain JSON). */

/** Window in unix seconds. Half-open by convention: [since, until). */
export type TimeWindow = { since?: number; until?: number };

export type ActivityMinute = {
  /** seconds epoch (UTC) */
  ts: number;
  steps: number;
  calories: number;
  /** centimetres (DAO scales m * 100) */
  distance: number;
  /** -1 = not measured */
  spo2: number;
  /** -1 = not measured, also signed-byte overflows possible */
  hr: number;
  /** -1 = not measured, 0 also a sentinel */
  rhr: number;
  rawKind: number;
  source: number;
};

export type SleepStageBlock = {
  /** ms epoch UTC */
  start: number;
  end: number;
  stage: 1 | 2 | 3 | 4;
};

export type SleepStats = {
  bedTime: number; // ms
  wakeupTime: number;
  risingTime: number;
  score: number;
  latencyMin: number;
  efficiency: number;
  deepPart: number;
  avgHrv: number;
  avgBreathRate: number;
  avgSpo2: number;
  avgHr: number;
};

export type ApneaEvent = {
  start: number; // ms
  end: number;
  level: number;
  durationSec: number;
};

export type StressSample = {
  ts: number; // seconds
  stress: number;
  level: number;
};

export type TempSample = {
  ts: number; // seconds
  celsius: number;
};

export type HrvSample = {
  ts: number; // seconds
  ms: number;
};

export type BatteryPoint = {
  ts: number; // seconds
  level: number;
};

export type UserProfile = {
  name: string;
  gender: number;
  birthdayMs: number;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  stepGoal: number;
  sleepGoalMin: number;
};

export type DeviceInfo = {
  name: string;
  manufacturer: string;
  model: string;
  identifier: string;
  firmware: string;
  pairedAt: number; // seconds
};

export type Anomaly = {
  id: string;
  severity: "info" | "warn";
  title: string;
  detail: string;
};

export type DaySummary = {
  windowStart: number; // seconds
  windowEnd: number;
  totalSteps: number;
  /** Always 0 — HUAWEI_ACTIVITY_SAMPLE.CALORIES is a firmware unit and NOT
   *  kcal. Display sites use workout-summary kcal instead. */
  totalCalories: number;
  /** Raw firmware-unit sum, kept for diagnostics. NEVER display as kcal. */
  totalCaloriesRaw: number;
  totalDistanceM: number;
  hrAvg: number;
  hrMin: number;
  hrMax: number;
  spo2Avg: number;
  stressAvg: number;
  tempAvg: number;
  hrvAvg: number;
};
