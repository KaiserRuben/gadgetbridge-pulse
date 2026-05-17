/**
 * Build the facts blob the LLM sees for a snapshot (single-day) period.
 *
 * Facts MUST be:
 * - Compact — only the fields the schema needs
 * - Pre-derived numbers (counts, percentages) so the model doesn't math-error
 * - Sentinel rows excluded (e.g. STEPS=-1)
 * - Human-readable timestamps in ISO Z
 */

import { db } from "../db.ts";
import { config } from "../config.ts";

export type SnapshotFactsBundle = {
  period_key: string;
  data_window: { start_iso: string; end_iso: string };
  samples_seen: {
    activity_rows: number;
    sleep_stage_rows: number;
    stress_rows: number;
    temp_rows: number;
    hrv_rows: number;
    apnea_rows: number;
  };

  user: {
    name: string;
    age_years: number;
    gender: number;
    height_cm: number;
    weight_kg: number;
    step_goal: number;
    sleep_goal_min: number;
  };

  device: {
    name: string;
    firmware: string;
  };

  sleep: SleepFacts | null;
  cardio: CardioFacts;
  activity: ActivityFacts;
  stress: StressFacts;
  body: BodyFacts;
  anomalies: AnomalyFacts;
};

export type SleepFacts = {
  stages: { light_min: number; rem_min: number; deep_min: number; awake_min: number };
  stats: {
    score: number;
    bedtime_iso: string;
    wakeup_iso: string;
    latency_min: number;
    efficiency_pct: number;
    deep_pct: number;
    avg_hrv_ms: number;
    avg_breath: number;
    avg_spo2: number;
    avg_hr: number;
    min_hr: number;
    max_hr: number;
    rdi: number;
    wake_count: number;
  };
  apnea: { start_iso: string; duration_s: number; level: number }[];
  baseline: null;
};

export type CardioFacts = {
  hr: { avg: number; min: number; max: number; samples: number };
  resting_hr: { avg: number; samples: number };
  hrv: { avg_ms: number; min_ms: number; max_ms: number; samples: number };
  signed_byte_overflow_rows: { ts_iso: string; raw: number; recovered_bpm: number }[];
  baseline: null;
};

export type ActivityFacts = {
  steps_total: number;
  calories_total: number;
  distance_m: number;
  active_minutes: number;
  sentinel_step_rows: number;
  total_minutes: number;
  hourly_steps: { hour: number; steps: number; calories: number }[];
  step_goal: number;
  goal_pct: number;
  baseline: null;
};

export type StressFacts = {
  samples: number;
  avg: number;
  peak: { value: number; ts_iso: string } | null;
  distribution_pct: { relaxed: number; mild: number; moderate: number; high: number };
  baseline: null;
};

export type BodyFacts = {
  skin_temp: { avg_c: number; min_c: number; max_c: number; samples: number };
  spo2: { avg_pct: number; min_pct: number; max_pct: number; samples: number };
  hrv: { avg_ms: number; samples: number };
  breath_rate_per_min: number | null;
  baseline: null;
};

export type AnomalyFacts = {
  hr_overflow_rows: number;
  negative_step_rows: number;
  hr_overflow_samples: { ts_iso: string; raw: number; recovered_bpm: number }[];
  data_notes: { id: string; title: string }[];
};

export function buildSnapshotFacts(periodKey: string): SnapshotFactsBundle {
  const handle = db();

  // ---- window: full activity range ------------------------------------------
  const win = handle
    .prepare<
      [],
      { min_ts: number; max_ts: number; n: number }
    >(
      "SELECT MIN(TIMESTAMP) AS min_ts, MAX(TIMESTAMP) AS max_ts, COUNT(*) AS n FROM HUAWEI_ACTIVITY_SAMPLE WHERE OTHER_TIMESTAMP > TIMESTAMP",
    )
    .get();
  if (!win) throw new Error("Empty activity table");

  // ---- user / device --------------------------------------------------------
  const u = handle
    .prepare<
      [],
      { NAME: string; BIRTHDAY: number; GENDER: number }
    >("SELECT NAME, BIRTHDAY, GENDER FROM USER LIMIT 1")
    .get();
  const ua = handle
    .prepare<
      [],
      { HEIGHT_CM: number; WEIGHT_KG: number; STEPS_GOAL_SPD: number; SLEEP_GOAL_MPD: number }
    >(
      "SELECT HEIGHT_CM, WEIGHT_KG, STEPS_GOAL_SPD, SLEEP_GOAL_MPD FROM USER_ATTRIBUTES WHERE VALID_TO_UTC IS NULL ORDER BY VALID_FROM_UTC DESC LIMIT 1",
    )
    .get();
  const dev = handle
    .prepare<[], { NAME: string }>("SELECT NAME FROM DEVICE LIMIT 1")
    .get();
  const fw = handle
    .prepare<[], { FIRMWARE_VERSION1: string }>(
      "SELECT FIRMWARE_VERSION1 FROM DEVICE_ATTRIBUTES ORDER BY VALID_FROM_UTC ASC LIMIT 1",
    )
    .get();

  // ---- sleep ----------------------------------------------------------------
  const sleepStats = handle
    .prepare<
      [],
      {
        SLEEP_SCORE: number;
        BED_TIME: number;
        WAKEUP_TIME: number;
        SLEEP_LATENCY: number;
        SLEEP_EFFICIENCY: number;
        DEEP_PART: number;
        AVG_HRV: number;
        AVG_BREATH_RATE: number;
        AVG_OXYGEN_SATURATION: number;
        AVG_HEART_RATE: number;
        MIN_HEART_RATE: number;
        MAX_HEART_RATE: number;
        RDI: number;
        WAKE_COUNT: number;
      }
    >(
      `SELECT SLEEP_SCORE, BED_TIME, WAKEUP_TIME, SLEEP_LATENCY, SLEEP_EFFICIENCY, DEEP_PART,
              AVG_HRV, AVG_BREATH_RATE, AVG_OXYGEN_SATURATION, AVG_HEART_RATE,
              MIN_HEART_RATE, MAX_HEART_RATE, RDI, WAKE_COUNT
       FROM HUAWEI_SLEEP_STATS_SAMPLE LIMIT 1`,
    )
    .get();

  const stageDur = handle
    .prepare<[], { stage: number; mins: number }>(
      "SELECT STAGE AS stage, COUNT(*) AS mins FROM HUAWEI_SLEEP_STAGE_SAMPLE GROUP BY STAGE",
    )
    .all();
  const stageMap: Record<number, number> = {};
  for (const r of stageDur) stageMap[r.stage] = r.mins;

  const apnea = handle
    .prepare<
      [],
      { TIMESTAMP: number; LAST_TIMESTAMP: number; LEVEL: number }
    >(
      "SELECT TIMESTAMP, LAST_TIMESTAMP, LEVEL FROM HUAWEI_SLEEP_APNEA_SAMPLE ORDER BY TIMESTAMP ASC",
    )
    .all();

  const sleep: SleepFacts | null = sleepStats
    ? {
        stages: {
          light_min: stageMap[1] ?? 0,
          rem_min: stageMap[2] ?? 0,
          deep_min: stageMap[3] ?? 0,
          awake_min: stageMap[4] ?? 0,
        },
        stats: {
          score: sleepStats.SLEEP_SCORE,
          bedtime_iso: new Date(sleepStats.BED_TIME).toISOString(),
          wakeup_iso: new Date(sleepStats.WAKEUP_TIME).toISOString(),
          latency_min: sleepStats.SLEEP_LATENCY,
          efficiency_pct: sleepStats.SLEEP_EFFICIENCY,
          deep_pct: sleepStats.DEEP_PART,
          avg_hrv_ms: sleepStats.AVG_HRV,
          avg_breath: sleepStats.AVG_BREATH_RATE,
          avg_spo2: sleepStats.AVG_OXYGEN_SATURATION,
          avg_hr: sleepStats.AVG_HEART_RATE,
          min_hr: sleepStats.MIN_HEART_RATE,
          max_hr: sleepStats.MAX_HEART_RATE,
          rdi: sleepStats.RDI,
          wake_count: sleepStats.WAKE_COUNT,
        },
        apnea: apnea.map((a) => ({
          start_iso: new Date(a.TIMESTAMP).toISOString(),
          duration_s: Math.max(1, Math.round((a.LAST_TIMESTAMP - a.TIMESTAMP) / 1000)),
          level: a.LEVEL,
        })),
        baseline: null,
      }
    : null;

  // ---- cardio ---------------------------------------------------------------
  const hr = handle
    .prepare<
      [],
      { avg: number; min: number; max: number; n: number }
    >(
      `SELECT AVG(HEART_RATE) AS avg, MIN(HEART_RATE) AS min, MAX(HEART_RATE) AS max, COUNT(*) AS n
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE HEART_RATE > 30 AND HEART_RATE < 220 AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get();
  const rhr = handle
    .prepare<
      [],
      { avg: number; n: number }
    >(
      `SELECT AVG(RESTING_HEART_RATE) AS avg, COUNT(*) AS n
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE RESTING_HEART_RATE > 30 AND RESTING_HEART_RATE < 200 AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get();
  const hrv = handle
    .prepare<
      [],
      { avg: number; min: number; max: number; n: number }
    >(
      `SELECT AVG(VALUE) AS avg, MIN(VALUE) AS min, MAX(VALUE) AS max, COUNT(*) AS n
       FROM HUAWEI_HRV_VALUE_SAMPLE`,
    )
    .get();
  const overflows = handle
    .prepare<
      [],
      { TIMESTAMP: number; HEART_RATE: number }
    >(
      `SELECT TIMESTAMP, HEART_RATE
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE HEART_RATE < 0 AND HEART_RATE != -1 AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .all();

  const cardio: CardioFacts = {
    hr: {
      avg: round(hr?.avg ?? 0, 1),
      min: hr?.min ?? 0,
      max: hr?.max ?? 0,
      samples: hr?.n ?? 0,
    },
    resting_hr: { avg: round(rhr?.avg ?? 0, 1), samples: rhr?.n ?? 0 },
    hrv: {
      avg_ms: round(hrv?.avg ?? 0, 1),
      min_ms: hrv?.min ?? 0,
      max_ms: hrv?.max ?? 0,
      samples: hrv?.n ?? 0,
    },
    signed_byte_overflow_rows: overflows.map((o) => ({
      ts_iso: new Date(o.TIMESTAMP * 1000).toISOString(),
      raw: o.HEART_RATE,
      recovered_bpm: 256 + o.HEART_RATE,
    })),
    baseline: null,
  };

  // ---- activity -------------------------------------------------------------
  const activityAgg = handle
    .prepare<
      [],
      {
        steps: number;
        cal: number;
        dist_cm: number;
        active_min: number;
        sentinel: number;
        total: number;
      }
    >(
      `SELECT
         COALESCE(SUM(CASE WHEN STEPS > 0 THEN STEPS ELSE 0 END), 0)       AS steps,
         COALESCE(SUM(CASE WHEN CALORIES > 0 THEN CALORIES ELSE 0 END), 0) AS cal,
         COALESCE(SUM(CASE WHEN DISTANCE > 0 THEN DISTANCE ELSE 0 END), 0) AS dist_cm,
         SUM(CASE WHEN STEPS > 0 THEN 1 ELSE 0 END)                         AS active_min,
         SUM(CASE WHEN STEPS = -1 THEN 1 ELSE 0 END)                        AS sentinel,
         COUNT(*)                                                            AS total
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get();

  // hourly buckets in local hour-of-day (Europe/Berlin = UTC+1 standard, +2 dst)
  const allRows = handle
    .prepare<[], { ts: number; steps: number; cal: number }>(
      `SELECT TIMESTAMP AS ts, STEPS AS steps, CALORIES AS cal
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .all();
  const buckets: Record<number, { steps: number; calories: number }> = {};
  for (let h = 0; h < 24; h++) buckets[h] = { steps: 0, calories: 0 };
  for (const r of allRows) {
    if (r.steps <= 0 && r.cal <= 0) continue;
    const utcHour = new Date(r.ts * 1000).getUTCHours();
    // Europe/Berlin offset for May = +2; runner timezone-aware version would use Intl.DateTimeFormat
    const h = (utcHour + 2) % 24;
    if (r.steps > 0) buckets[h].steps += r.steps;
    if (r.cal > 0) buckets[h].calories += r.cal;
  }

  const activity: ActivityFacts = {
    steps_total: activityAgg?.steps ?? 0,
    calories_total: activityAgg?.cal ?? 0,
    // DISTANCE column is metres on GT 5 Pro (not cm). See facts/queries/activity.ts.
    distance_m: round(activityAgg?.dist_cm ?? 0, 2),
    active_minutes: activityAgg?.active_min ?? 0,
    sentinel_step_rows: activityAgg?.sentinel ?? 0,
    total_minutes: activityAgg?.total ?? 0,
    hourly_steps: Object.entries(buckets).map(([h, v]) => ({
      hour: Number(h),
      steps: v.steps,
      calories: v.calories,
    })),
    step_goal: ua?.STEPS_GOAL_SPD ?? 10000,
    goal_pct: round(((activityAgg?.steps ?? 0) / (ua?.STEPS_GOAL_SPD ?? 10000)) * 100, 1),
    baseline: null,
  };

  // ---- stress ---------------------------------------------------------------
  const stressRows = handle
    .prepare<[], { TIMESTAMP: number; STRESS: number }>(
      "SELECT TIMESTAMP, STRESS FROM HUAWEI_STRESS_SAMPLE ORDER BY TIMESTAMP ASC",
    )
    .all();
  const stressVals = stressRows.map((r) => r.STRESS);
  const stressDist = bucketStress(stressVals);
  const stressPeakRow =
    stressRows.length > 0
      ? stressRows.reduce((a, b) => (a.STRESS >= b.STRESS ? a : b))
      : null;
  const stress: StressFacts = {
    samples: stressVals.length,
    avg: stressVals.length ? round(stressVals.reduce((a, b) => a + b, 0) / stressVals.length, 1) : 0,
    peak: stressPeakRow
      ? {
          value: stressPeakRow.STRESS,
          ts_iso: tsToIso(stressPeakRow.TIMESTAMP),
        }
      : null,
    distribution_pct: stressDist,
    baseline: null,
  };

  // ---- body -----------------------------------------------------------------
  const tempAgg = handle
    .prepare<
      [],
      { avg: number; min: number; max: number; n: number }
    >(
      `SELECT AVG(TEMPERATURE) AS avg, MIN(TEMPERATURE) AS min,
              MAX(TEMPERATURE) AS max, COUNT(*) AS n
       FROM HUAWEI_TEMPERATURE_SAMPLE`,
    )
    .get();
  const spoAgg = handle
    .prepare<
      [],
      { avg: number; min: number; max: number; n: number }
    >(
      `SELECT AVG(SPO) AS avg, MIN(SPO) AS min, MAX(SPO) AS max, COUNT(*) AS n
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE SPO > 80 AND SPO <= 100 AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get();
  const body: BodyFacts = {
    skin_temp: {
      avg_c: round(tempAgg?.avg ?? 0, 2),
      min_c: round(tempAgg?.min ?? 0, 2),
      max_c: round(tempAgg?.max ?? 0, 2),
      samples: tempAgg?.n ?? 0,
    },
    spo2: {
      avg_pct: round(spoAgg?.avg ?? 0, 1),
      min_pct: spoAgg?.min ?? 0,
      max_pct: spoAgg?.max ?? 0,
      samples: spoAgg?.n ?? 0,
    },
    hrv: { avg_ms: cardio.hrv.avg_ms, samples: cardio.hrv.samples },
    breath_rate_per_min: sleep?.stats.avg_breath ?? null,
    baseline: null,
  };

  // ---- anomalies ------------------------------------------------------------
  const negStepsRows = handle
    .prepare<[], { n: number }>(
      `SELECT COUNT(*) AS n FROM HUAWEI_ACTIVITY_SAMPLE WHERE STEPS < 0 AND STEPS != -1 AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get();
  const anomalies: AnomalyFacts = {
    hr_overflow_rows: cardio.signed_byte_overflow_rows.length,
    negative_step_rows: negStepsRows?.n ?? 0,
    hr_overflow_samples: cardio.signed_byte_overflow_rows,
    data_notes: [
      { id: "calorie-unit", title: "Calorie counter is firmware-raw, not kcal" },
      { id: "distance-scale", title: "Distance stored in centimetres" },
      { id: "minute-double", title: "Each minute stored twice; backward rows are sentinel" },
    ],
  };

  // ---- assemble -------------------------------------------------------------
  const ageYears = u?.BIRTHDAY ? (Date.now() - u.BIRTHDAY) / (365.25 * 24 * 3600 * 1000) : 0;

  return {
    period_key: periodKey,
    data_window: {
      start_iso: tsToIso(win.min_ts),
      end_iso: tsToIso(win.max_ts),
    },
    samples_seen: {
      activity_rows: win.n,
      sleep_stage_rows: stageDur.reduce((a, b) => a + b.mins, 0),
      stress_rows: stressVals.length,
      temp_rows: tempAgg?.n ?? 0,
      hrv_rows: hrv?.n ?? 0,
      apnea_rows: apnea.length,
    },
    user: {
      name: u?.NAME ?? "Unknown",
      age_years: round(ageYears, 1),
      gender: u?.GENDER ?? 0,
      height_cm: ua?.HEIGHT_CM ?? 0,
      weight_kg: ua?.WEIGHT_KG ?? 0,
      step_goal: ua?.STEPS_GOAL_SPD ?? 10000,
      sleep_goal_min: ua?.SLEEP_GOAL_MPD ?? 480,
    },
    device: {
      name: dev?.NAME ?? "?",
      firmware: fw?.FIRMWARE_VERSION1 ?? "?",
    },
    sleep,
    cardio,
    activity,
    stress,
    body,
    anomalies,
  };
}

function bucketStress(values: number[]) {
  if (values.length === 0) return { relaxed: 0, mild: 0, moderate: 0, high: 0 };
  const counts = { relaxed: 0, mild: 0, moderate: 0, high: 0 };
  for (const v of values) {
    if (v < 30) counts.relaxed++;
    else if (v < 60) counts.mild++;
    else if (v < 80) counts.moderate++;
    else counts.high++;
  }
  const total = values.length;
  return {
    relaxed: round((counts.relaxed / total) * 100, 0),
    mild: round((counts.mild / total) * 100, 0),
    moderate: round((counts.moderate / total) * 100, 0),
    high: round((counts.high / total) * 100, 0),
  };
}

function tsToIso(ts: number) {
  // Heuristic: if > 1e12 it's already ms.
  return new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
}

function round(n: number, d: number) {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}
