/**
 * Date-windowed cardio facts: HR, RHR, HRV in a single day.
 *
 * Notes:
 *   - HUAWEI_ACTIVITY_SAMPLE.TIMESTAMP is in UNIX SECONDS.
 *   - HUAWEI_HRV_VALUE_SAMPLE.TIMESTAMP is in UNIX MILLISECONDS (despite an
 *     older comment — verified against current GT 5 Pro export). New series
 *     query uses ms; the existing aggregate query is left untouched
 *     (additive-only constraint).
 *   - Sentinel rows: backward double-store (OTHER_TIMESTAMP <= TIMESTAMP)
 *     are filtered out; the "real" row is the one where OTHER_TIMESTAMP > TIMESTAMP.
 *   - HEART_RATE is stored as a signed byte: values 1..127 are literal bpm,
 *     -128..-2 represent 128..254 bpm (`256 + raw`), -1 is the missing
 *     sentinel. We use the corrected expression `CASE WHEN HEART_RATE < 0
 *     AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END` and
 *     validate the corrected value to 31..219 bpm.
 *   - RHR validity: 31..199 bpm.
 */
const HR_CORRECTED =
  "(CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END)";
const RHR_CORRECTED =
  "(CASE WHEN RESTING_HEART_RATE < 0 AND RESTING_HEART_RATE != -1 THEN 256 + RESTING_HEART_RATE ELSE RESTING_HEART_RATE END)";

import type Database from "better-sqlite3";
import type { DayWindow } from "../window.ts";

export interface HrvSeriesPoint {
  ts_iso: string;
  value_ms: number;
}

export interface CardioFactsRaw {
  metrics: {
    rhr_day_bpm: number | null;
    hr_max_bpm: number | null;
    hr_mean_bpm: number | null;
    spo2_mean_pct: number | null;
  };
  /** All HR rows in window — for signal-quality / samples_seen. */
  hrRowCount: number;
  /** HRV samples in window. */
  hrvSamples: number;
  hrvMeanMs: number | null;
  /** SpO2 sample count for downstream signal-quality. */
  spo2RowCount: number;
  /** Raw HRV samples for the day (≤200, downsampled if more). */
  hrvSeries: HrvSeriesPoint[];
}

export function queryCardio(db: Database.Database, win: DayWindow): CardioFactsRaw {
  const hrAgg = db
    .prepare<[number, number], { avg: number | null; max: number | null; n: number }>(
      `SELECT AVG(${HR_CORRECTED}) AS avg, MAX(${HR_CORRECTED}) AS max, COUNT(*) AS n
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND ${HR_CORRECTED} BETWEEN 31 AND 219
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(win.startSec as number, win.endSec as number);

  const rhr = db
    .prepare<[number, number], { avg: number | null }>(
      `SELECT AVG(${RHR_CORRECTED}) AS avg
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND ${RHR_CORRECTED} BETWEEN 31 AND 199
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(win.startSec as number, win.endSec as number);

  const spoAgg = db
    .prepare<[number, number], { avg: number | null; n: number }>(
      `SELECT AVG(SPO) AS avg, COUNT(*) AS n
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND SPO BETWEEN 50 AND 100
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(win.startSec as number, win.endSec as number);

  // HUAWEI_HRV_VALUE_SAMPLE.TIMESTAMP is in MILLISECONDS — must use startMs/endMs.
  const hrvAgg = db
    .prepare<[number, number], { avg: number | null; n: number }>(
      `SELECT AVG(VALUE) AS avg, COUNT(*) AS n
       FROM HUAWEI_HRV_VALUE_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND VALUE BETWEEN 1 AND 250`,
    )
    .get(win.startMs as number, win.endMs as number);

  // HRV series — TIMESTAMP is in milliseconds. Pull all rows, downsample to
  // ≤200 samples per day for JSON-size budgeting. Errors are swallowed so a
  // missing table on older Gadgetbridge schemas doesn't break the bundle.
  const hrvSeries = readHrvSeries(db, win);

  return {
    metrics: {
      rhr_day_bpm: rhr?.avg !== null && rhr?.avg !== undefined ? round(rhr.avg, 1) : null,
      hr_max_bpm: hrAgg?.max ?? null,
      hr_mean_bpm: hrAgg?.avg !== null && hrAgg?.avg !== undefined ? round(hrAgg.avg, 1) : null,
      spo2_mean_pct: spoAgg?.avg !== null && spoAgg?.avg !== undefined ? round(spoAgg.avg, 1) : null,
    },
    hrRowCount: hrAgg?.n ?? 0,
    hrvSamples: hrvAgg?.n ?? 0,
    hrvMeanMs: hrvAgg?.avg !== null && hrvAgg?.avg !== undefined ? round(hrvAgg.avg, 1) : null,
    spo2RowCount: spoAgg?.n ?? 0,
    hrvSeries,
  };
}

const HRV_SERIES_CAP = 200;

function readHrvSeries(db: Database.Database, win: DayWindow): HrvSeriesPoint[] {
  try {
    const rows = db
      .prepare<[number, number], { ts: number; v: number }>(
        `SELECT TIMESTAMP AS ts, VALUE AS v
         FROM HUAWEI_HRV_VALUE_SAMPLE
         WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
           AND VALUE BETWEEN 1 AND 250
         ORDER BY TIMESTAMP ASC`,
      )
      .all(win.startMs as number, win.endMs as number);

    if (rows.length === 0) return [];
    const stride = rows.length > HRV_SERIES_CAP ? Math.ceil(rows.length / HRV_SERIES_CAP) : 1;
    const out: HrvSeriesPoint[] = [];
    for (let i = 0; i < rows.length; i += stride) {
      const r = rows[i];
      out.push({ ts_iso: new Date(r.ts).toISOString(), value_ms: r.v });
    }
    return out.slice(0, HRV_SERIES_CAP);
  } catch (err) {
    console.warn(`[cardio] hrv series read failed: ${(err as Error).message}`);
    return [];
  }
}

function round(n: number, d: number): number {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}
