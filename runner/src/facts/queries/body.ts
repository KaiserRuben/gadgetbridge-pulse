/**
 * Date-windowed body facts: skin temperature, weight, BMI.
 *
 * Notes:
 *   - HUAWEI_TEMPERATURE_SAMPLE.TIMESTAMP — millisecond-or-second mixed.
 *     We query both forms via OR.
 *   - Weight currently has no Huawei-specific table; we leave it null.
 *   - BMI is derived from weight + height (caller supplies height).
 *
 * Returns aggregated metrics; signal-quality is computed in `signal-quality.ts`.
 */

import type Database from "better-sqlite3";
import { dayWindow, shiftDateKey } from "../window.ts";
import type { DayWindow } from "../window.ts";

export interface BodyFactsRaw {
  metrics: {
    weight_kg: number | null;
    body_fat_pct: number | null;
    bmi: number | null;
    skin_temp_median: number | null;
    skin_temp_delta_c: number | null;
  };
  /** Skin-temp samples in window — for signal-quality. */
  tempSamples: number;
  tempMedianC: number | null;
  /** SpO2 row count, for samples_seen.spo2_rows. */
  spo2RowCount: number;
}

export function queryBody(
  db: Database.Database,
  win: DayWindow,
  heightCm: number | null,
  weightKgFromProfile: number | null,
  periodKey?: string,
  timezone = "Europe/Berlin",
): BodyFactsRaw {
  // Skin temperature: try ms then sec.
  const tempAgg = db
    .prepare<
      [number, number, number, number],
      { avg: number | null; median: number | null; n: number }
    >(
      `SELECT AVG(TEMPERATURE) AS avg, AVG(TEMPERATURE) AS median, COUNT(*) AS n
       FROM HUAWEI_TEMPERATURE_SAMPLE
       WHERE (TIMESTAMP >= ? AND TIMESTAMP < ?)
          OR (TIMESTAMP >= ? AND TIMESTAMP < ?)`,
    )
    .get(
      win.startMs as number,
      win.endMs as number,
      win.startSec as number,
      win.endSec as number,
    );

  // Robust median via SQLite is awkward; pull all values when n is small.
  let median: number | null = null;
  if ((tempAgg?.n ?? 0) > 0) {
    const rows = db
      .prepare<
        [number, number, number, number],
        { v: number }
      >(
        `SELECT TEMPERATURE AS v
         FROM HUAWEI_TEMPERATURE_SAMPLE
         WHERE (TIMESTAMP >= ? AND TIMESTAMP < ?)
            OR (TIMESTAMP >= ? AND TIMESTAMP < ?)
         ORDER BY TEMPERATURE ASC`,
      )
      .all(
        win.startMs as number,
        win.endMs as number,
        win.startSec as number,
        win.endSec as number,
      );
    if (rows.length > 0) {
      const mid = Math.floor(rows.length / 2);
      median = rows.length % 2 === 0 ? (rows[mid - 1].v + rows[mid].v) / 2 : rows[mid].v;
    }
  }

  const spo2Count = db
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND SPO BETWEEN 50 AND 100
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(win.startSec as number, win.endSec as number);

  let bmi: number | null = null;
  if (heightCm && weightKgFromProfile && heightCm > 0 && weightKgFromProfile > 0) {
    const m = heightCm / 100;
    bmi = round(weightKgFromProfile / (m * m), 1);
  }

  // Skin-temp baseline delta: today's median minus the 14-day trailing
  // median (excluding today). Requires periodKey to compute the baseline
  // window — falls back to null when not supplied.
  let skinTempDelta: number | null = null;
  if (periodKey && median !== null) {
    const baseline = computeSkinTempBaseline14d(db, periodKey, timezone);
    if (baseline !== null) skinTempDelta = round(median - baseline, 2);
  }

  return {
    metrics: {
      weight_kg: weightKgFromProfile && weightKgFromProfile > 0 ? weightKgFromProfile : null,
      body_fat_pct: null,
      bmi,
      skin_temp_median: median !== null ? round(median, 2) : null,
      skin_temp_delta_c: skinTempDelta,
    },
    tempSamples: tempAgg?.n ?? 0,
    tempMedianC: median !== null ? round(median, 2) : null,
    spo2RowCount: spo2Count?.n ?? 0,
  };
}

/**
 * 14-day trailing median of daily skin-temp medians (strictly excludes today).
 * Returns null if fewer than 3 daily medians are available — the rule engine
 * already tolerates null deltas.
 */
function computeSkinTempBaseline14d(
  db: Database.Database,
  periodKey: string,
  timezone: string,
): number | null {
  const startKey = shiftDateKey(periodKey, 14);
  const endKey = shiftDateKey(periodKey, 1);
  const startWin = dayWindow(startKey, timezone);
  const endWin = dayWindow(endKey, timezone);
  const startMs = startWin.startMs as number;
  const endMs = endWin.endMs as number;
  const startSec = startWin.startSec as number;
  const endSec = endWin.endSec as number;

  let rows: { v: number; ts: number }[] = [];
  try {
    rows = db
      .prepare<[number, number, number, number], { v: number; ts: number }>(
        `SELECT TEMPERATURE AS v, TIMESTAMP AS ts
         FROM HUAWEI_TEMPERATURE_SAMPLE
         WHERE (TIMESTAMP >= ? AND TIMESTAMP < ?)
            OR (TIMESTAMP >= ? AND TIMESTAMP < ?)`,
      )
      .all(startMs, endMs, startSec, endSec);
  } catch (err) {
    console.warn(`[body] skin-temp baseline read failed: ${(err as Error).message}`);
    return null;
  }

  // Bucket per local day (rough — uses UTC date of timestamp; matches the
  // 14-day-history granularity used elsewhere). Rows can carry either ms or
  // sec; coerce to seconds for the bucket key.
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const tsSec = r.ts > 1e12 ? Math.floor(r.ts / 1000) : r.ts;
    const dt = new Date(tsSec * 1000);
    const key = dt.toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(r.v);
    else byDay.set(key, [r.v]);
  }

  const dailyMedians: number[] = [];
  for (const vals of byDay.values()) {
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    const m = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
    if (Number.isFinite(m)) dailyMedians.push(m);
  }

  if (dailyMedians.length < 3) return null;
  dailyMedians.sort((a, b) => a - b);
  const mid = Math.floor(dailyMedians.length / 2);
  return dailyMedians.length % 2 === 0
    ? (dailyMedians[mid - 1] + dailyMedians[mid]) / 2
    : dailyMedians[mid];
}

function round(n: number, d: number): number {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}
