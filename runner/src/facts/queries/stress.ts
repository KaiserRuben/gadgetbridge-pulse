/**
 * Date-windowed stress facts.
 *
 * Notes:
 *   - HUAWEI_STRESS_SAMPLE.TIMESTAMP is in UNIX **MILLISECONDS** on this
 *     device (verified against GT 5 Pro export, 2026-05-13).
 *   - STRESS values are 0..99. A "high" stress sample is STRESS ≥ 80
 *     (matching the v1 dashboard's distribution buckets).
 *   - Daytime samples = 06:00..22:00 local. Used by signal-quality.
 */

import type Database from "better-sqlite3";
import type { DayWindow } from "../window.ts";

export interface StressFactsRaw {
  metrics: {
    stress_mean: number | null;
    stress_max: number | null;
    high_stress_minutes: number | null;
  };
  /** All stress rows in window — for samples_seen. */
  rowCount: number;
  /** Daytime sample count (06:00–22:00 local) — for signal-quality. */
  daytimeSamples: number;
}

const HIGH_STRESS_THRESHOLD = 80;

export function queryStress(db: Database.Database, win: DayWindow): StressFactsRaw {
  const startMs = win.startMs as number;
  const endMs = win.endMs as number;

  const agg = db
    .prepare<
      [number, number],
      { avg: number | null; max: number | null; high: number; total: number }
    >(
      `SELECT AVG(STRESS) AS avg, MAX(STRESS) AS max,
              SUM(CASE WHEN STRESS >= ${HIGH_STRESS_THRESHOLD} THEN 1 ELSE 0 END) AS high,
              COUNT(*) AS total
       FROM HUAWEI_STRESS_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND STRESS BETWEEN 0 AND 99`,
    )
    .get(startMs, endMs);

  // Daytime window: derive 06:00..22:00 local by adding 6h to start and
  // subtracting 2h from end (both in ms).
  const dayStart = startMs + 6 * 3600 * 1000;
  const dayEnd = endMs - 2 * 3600 * 1000;
  const daytime = db
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n
       FROM HUAWEI_STRESS_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND STRESS BETWEEN 0 AND 99`,
    )
    .get(dayStart, dayEnd);

  return {
    metrics: {
      stress_mean: agg?.avg !== null && agg?.avg !== undefined ? round(agg.avg, 1) : null,
      stress_max: agg?.max ?? null,
      high_stress_minutes: agg?.high ?? 0,
    },
    rowCount: agg?.total ?? 0,
    daytimeSamples: daytime?.n ?? 0,
  };
}

function round(n: number, d: number): number {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}
