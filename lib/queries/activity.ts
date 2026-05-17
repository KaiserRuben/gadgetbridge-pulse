import "server-only";
import { db } from "../db";
import type { ActivityMinute, BatteryPoint, DaySummary } from "../types";

/**
 * Activity rows are double-stored per minute: a forward row (OTHER_TIMESTAMP = TS+60,
 * real data) and a backward row (OTHER_TIMESTAMP = TS-60, all sentinel). We filter
 * to forward rows for clean time series.
 *
 * Aggregations are pushed to SQL where possible — keeps Pi-scale costs down
 * once the DB grows beyond a single day.
 */
export function getActivityMinutes(opts?: { since?: number; until?: number }): ActivityMinute[] {
  const where = ["OTHER_TIMESTAMP > TIMESTAMP"];
  const params: number[] = [];
  if (opts?.since != null) {
    where.push("TIMESTAMP >= ?");
    params.push(opts.since);
  }
  if (opts?.until != null) {
    where.push("TIMESTAMP <= ?");
    params.push(opts.until);
  }
  return db()
    .prepare<number[], ActivityMinute>(
      `SELECT
         TIMESTAMP             AS ts,
         STEPS                 AS steps,
         CALORIES              AS calories,
         DISTANCE              AS distance,
         SPO                   AS spo2,
         HEART_RATE            AS hr,
         RESTING_HEART_RATE    AS rhr,
         RAW_KIND              AS rawKind,
         SOURCE                AS source
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE ${where.join(" AND ")}
       ORDER BY TIMESTAMP ASC`,
    )
    .all(...params);
}

/** SQL-side aggregation. Single round-trip, no JS reduce, scales to year+. */
export function getDaySummary(opts?: { since?: number; until?: number }): DaySummary {
  const where = ["OTHER_TIMESTAMP > TIMESTAMP"];
  const params: number[] = [];
  if (opts?.since != null) {
    where.push("TIMESTAMP >= ?");
    params.push(opts.since);
  }
  if (opts?.until != null) {
    where.push("TIMESTAMP <= ?");
    params.push(opts.until);
  }
  const w = where.join(" AND ");

  const r = db()
    .prepare<
      number[],
      {
        win_start: number | null;
        win_end: number | null;
        total_steps: number;
        total_calories: number;
        total_distance_cm: number;
        hr_avg: number | null;
        hr_min: number | null;
        hr_max: number | null;
        hr_count: number;
        spo_avg: number | null;
      }
    >(
      `SELECT
         MIN(TIMESTAMP)                                                         AS win_start,
         MAX(TIMESTAMP)                                                         AS win_end,
         COALESCE(SUM(CASE WHEN STEPS    > 0 THEN STEPS    ELSE 0 END), 0)      AS total_steps,
         COALESCE(SUM(CASE WHEN CALORIES > 0 THEN CALORIES ELSE 0 END), 0)      AS total_calories,
         COALESCE(SUM(CASE WHEN DISTANCE > 0 THEN DISTANCE ELSE 0 END), 0)      AS total_distance_cm,
         AVG(CASE WHEN (CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END) BETWEEN 31 AND 219 THEN (CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END) END) AS hr_avg,
         MIN(CASE WHEN (CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END) BETWEEN 31 AND 219 THEN (CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END) END) AS hr_min,
         MAX(CASE WHEN (CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END) BETWEEN 31 AND 219 THEN (CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END) END) AS hr_max,
         SUM(CASE WHEN (CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END) BETWEEN 31 AND 219 THEN 1 ELSE 0 END) AS hr_count,
         AVG(CASE WHEN SPO BETWEEN 81 AND 100 THEN SPO END)                     AS spo_avg
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE ${w}`,
    )
    .get(...params);

  // HUAWEI_ACTIVITY_SAMPLE.CALORIES is firmware-scaled: firmware_unit / 1000 ≈
  // active kcal (verified against workout-summary kcal — 5-9 workout windows
  // had fw_sum 2 297 624 vs workout-summary 2 445 kcal, ~6% off; sedentary
  // days yield ~100–400 kcal, hike days 2 500+, all plausible). This is
  // *active* kcal (movement-driven), not TEE — BMR is not included.
  return {
    windowStart: r?.win_start ?? 0,
    windowEnd: r?.win_end ?? 0,
    totalSteps: r?.total_steps ?? 0,
    totalCalories: Math.round((r?.total_calories ?? 0) / 1000),
    totalCaloriesRaw: r?.total_calories ?? 0,
    // HUAWEI_ACTIVITY_SAMPLE.DISTANCE is metres on GT 5 Pro (not cm). The
    // legacy variable name `total_distance_cm` is preserved to avoid a schema
    // shuffle, but no /100 divisor is applied.
    totalDistanceM: r?.total_distance_cm ?? 0,
    hrAvg: r?.hr_avg ?? 0,
    hrMin: r?.hr_min ?? 0,
    hrMax: r?.hr_max ?? 0,
    spo2Avg: r?.spo_avg ?? 0,
    stressAvg: 0,
    tempAvg: 0,
    hrvAvg: 0,
  };
}

function applyWindow(opts?: { since?: number; until?: number }, base = "OTHER_TIMESTAMP > TIMESTAMP") {
  const where = [base];
  const params: number[] = [];
  if (opts?.since != null) {
    where.push("TIMESTAMP >= ?");
    params.push(opts.since);
  }
  if (opts?.until != null) {
    where.push("TIMESTAMP < ?");
    params.push(opts.until);
  }
  return { sql: where.join(" AND "), params };
}

/**
 * Hourly buckets in local hour-of-day (Europe/Berlin). SQL groups, JS only
 * computes the local-hour offset using Intl for DST awareness.
 */
export function getHourlySteps(opts?: { since?: number; until?: number }): {
  hour: number;
  steps: number;
  calories: number;
}[] {
  const { sql, params } = applyWindow(opts);
  const rows = db()
    .prepare<
      number[],
      { ts: number; steps: number; cal: number }
    >(
      `SELECT TIMESTAMP AS ts, STEPS AS steps, CALORIES AS cal
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE ${sql} AND (STEPS > 0 OR CALORIES > 0)`,
    )
    .all(...params);

  const hourFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hourCycle: "h23",
  });

  const buckets = new Map<number, { steps: number; calories: number }>();
  for (const r of rows) {
    const h = parseInt(hourFmt.format(new Date(r.ts * 1000)), 10);
    const cur = buckets.get(h) ?? { steps: 0, calories: 0 };
    if (r.steps > 0) cur.steps += r.steps;
    if (r.cal > 0) cur.calories += r.cal;
    buckets.set(h, cur);
  }
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    steps: buckets.get(h)?.steps ?? 0,
    calories: buckets.get(h)?.calories ?? 0,
  }));
}

export function getHrSeries(opts?: { since?: number; until?: number }): { ts: number; hr: number }[] {
  const { sql, params } = applyWindow(opts);
  return db()
    .prepare<number[], { ts: number; hr: number }>(
      `SELECT TIMESTAMP AS ts, HEART_RATE AS hr
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE ${sql} AND HEART_RATE BETWEEN 31 AND 219
       ORDER BY TIMESTAMP ASC`,
    )
    .all(...params);
}

export function getSpo2Series(opts?: { since?: number; until?: number }): { ts: number; spo2: number }[] {
  const { sql, params } = applyWindow(opts);
  return db()
    .prepare<number[], { ts: number; spo2: number }>(
      `SELECT TIMESTAMP AS ts, SPO AS spo2
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE ${sql} AND SPO BETWEEN 81 AND 100
       ORDER BY TIMESTAMP ASC`,
    )
    .all(...params);
}

export function getBattery(opts?: { since?: number; until?: number }): BatteryPoint[] {
  const where: string[] = [];
  const params: number[] = [];
  if (opts?.since != null) {
    where.push("TIMESTAMP >= ?");
    params.push(opts.since);
  }
  if (opts?.until != null) {
    where.push("TIMESTAMP < ?");
    params.push(opts.until);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db()
    .prepare<number[], BatteryPoint>(
      `SELECT TIMESTAMP AS ts, LEVEL AS level FROM BATTERY_LEVEL ${w} ORDER BY TIMESTAMP ASC`,
    )
    .all(...params);
}
