/**
 * Compute personal baselines (median + MAD) for the previous 30 daily
 * aggregates, for each metric domain.
 *
 * Locked policy:
 *   - Window = 30 days strictly preceding the period_key (NOT including
 *     today). If <3 days of data are available, baseline=null.
 *   - 3..13 days: baseline populated but `n` flags partial coverage.
 *   - ≥14 days: baseline considered "established" by downstream gates.
 *
 * Each metric's baseline carries `{ median, mad, n, window_days }` per the
 * BaselineCore schema. MAD is scaled by 1.4826 (≈σ for normal data).
 */

import type Database from "better-sqlite3";
import { dayWindow, shiftDateKey } from "./window.ts";
import { median, mad } from "../rules/stats.ts";
import type { BaselineCore } from "@/lib/types/generated";

export interface BaselineBundle {
  sleep: Record<string, BaselineCore | undefined> | null;
  cardio: Record<string, BaselineCore | undefined> | null;
  activity: Record<string, BaselineCore | undefined> | null;
  stress: Record<string, BaselineCore | undefined> | null;
  body: Record<string, BaselineCore | undefined> | null;
}

const WINDOW_DAYS = 30;
const MIN_DAYS = 3;

/** Pull the daily metric aggregates for the 30-day baseline window. */
export function computeBaselines(
  periodKey: string,
  db: Database.Database,
  timezone = "Europe/Berlin",
): BaselineBundle {
  // Window covers periodKey-30 through periodKey-1 inclusive (excludes today).
  const startKey = shiftDateKey(periodKey, WINDOW_DAYS);
  const endKey = shiftDateKey(periodKey, 1);
  const startWin = dayWindow(startKey, timezone);
  const endWin = dayWindow(endKey, timezone);
  const startSec = startWin.startSec as number;
  const endSec = endWin.endSec as number;
  const startMs = startWin.startMs as number;
  const endMs = endWin.endMs as number;

  // ── Sleep daily aggregates ─────────────────────────────────────────────────
  // We bucket by wake-date (UTC date of WAKEUP_TIME). Light approximation; the
  // engine's history buffers are oldest-first daily series.
  const sleepDays = db
    .prepare<
      [number, number],
      {
        wake_date: string;
        tst: number | null;
        eff: number | null;
        rem: number | null;
        deep: number | null;
        rmssd: number | null;
        spo2_min: number | null;
      }
    >(
      `SELECT
         strftime('%Y-%m-%d', WAKEUP_TIME / 1000, 'unixepoch') AS wake_date,
         (SLEEP_EFFICIENCY * (WAKEUP_TIME - BED_TIME) / 100 / 60000) AS tst,
         SLEEP_EFFICIENCY AS eff,
         NULL AS rem,
         NULL AS deep,
         AVG_HRV AS rmssd,
         AVG_OXYGEN_SATURATION AS spo2_min
       FROM HUAWEI_SLEEP_STATS_SAMPLE
       WHERE WAKEUP_TIME >= ? AND WAKEUP_TIME < ?`,
    )
    .all(startMs, endMs);

  // ── Cardio daily aggregates ────────────────────────────────────────────────
  const cardioDays = db
    .prepare<
      [number, number],
      { d: string; rhr: number | null; hr_max: number | null; hr_mean: number | null; spo2: number | null }
    >(
      `SELECT
         strftime('%Y-%m-%d', TIMESTAMP, 'unixepoch') AS d,
         AVG(CASE WHEN RESTING_HEART_RATE BETWEEN 31 AND 199 THEN RESTING_HEART_RATE END) AS rhr,
         MAX(CASE WHEN HEART_RATE BETWEEN 31 AND 219 THEN HEART_RATE END) AS hr_max,
         AVG(CASE WHEN HEART_RATE BETWEEN 31 AND 219 THEN HEART_RATE END) AS hr_mean,
         AVG(CASE WHEN SPO BETWEEN 50 AND 100 THEN SPO END) AS spo2
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND OTHER_TIMESTAMP > TIMESTAMP
       GROUP BY d`,
    )
    .all(startSec, endSec);

  const activityDays = db
    .prepare<
      [number, number],
      { d: string; steps: number | null; cal: number | null; active: number | null }
    >(
      `SELECT
         strftime('%Y-%m-%d', TIMESTAMP, 'unixepoch') AS d,
         SUM(CASE WHEN STEPS > 0 THEN STEPS ELSE 0 END) AS steps,
         SUM(CASE WHEN CALORIES > 0 THEN CALORIES ELSE 0 END) AS cal,
         SUM(CASE WHEN STEPS >= 30 THEN 1 ELSE 0 END) AS active
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND OTHER_TIMESTAMP > TIMESTAMP
       GROUP BY d`,
    )
    .all(startSec, endSec);

  const stressDays = db
    .prepare<
      [number, number],
      { d: string; mean: number | null; max: number | null; high: number | null }
    >(
      `SELECT
         strftime('%Y-%m-%d', TIMESTAMP, 'unixepoch') AS d,
         AVG(STRESS) AS mean,
         MAX(STRESS) AS max,
         SUM(CASE WHEN STRESS >= 80 THEN 1 ELSE 0 END) AS high
       FROM HUAWEI_STRESS_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
       GROUP BY d`,
    )
    .all(startSec, endSec);

  return {
    sleep: maybeBaseline({
      tst_min: sleepDays.map((r) => r.tst),
      sleep_efficiency_pct: sleepDays.map((r) => r.eff),
      rmssd_ms: sleepDays.map((r) => r.rmssd),
      spo2_min_pct: sleepDays.map((r) => r.spo2_min),
    }),
    cardio: maybeBaseline({
      rhr_day_bpm: cardioDays.map((r) => r.rhr),
      hr_max_bpm: cardioDays.map((r) => r.hr_max),
      hr_mean_bpm: cardioDays.map((r) => r.hr_mean),
      spo2_mean_pct: cardioDays.map((r) => r.spo2),
    }),
    activity: maybeBaseline({
      steps: activityDays.map((r) => r.steps),
      active_minutes: activityDays.map((r) => r.active),
      calories_kcal: activityDays.map((r) => r.cal),
    }),
    stress: maybeBaseline({
      stress_mean: stressDays.map((r) => r.mean),
      stress_max: stressDays.map((r) => r.max),
      high_stress_minutes: stressDays.map((r) => r.high),
    }),
    body: null,
  };
}

/**
 * Build a per-metric baseline map. If every series has fewer than MIN_DAYS
 * finite samples the entire domain returns null. Otherwise each metric gets
 * its own BaselineCore (sparse metrics may still have null fields).
 */
function maybeBaseline(
  series: Record<string, (number | null)[]>,
): Record<string, BaselineCore | undefined> | null {
  const entries: [string, BaselineCore][] = [];
  let anyOk = false;
  for (const [k, raw] of Object.entries(series)) {
    const clean = raw.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (clean.length < MIN_DAYS) continue;
    const med = median(clean);
    const m = mad(clean, med);
    if (!Number.isFinite(med)) continue;
    entries.push([
      k,
      {
        median: round(med, 3),
        mad: Number.isFinite(m) ? round(m, 3) : null,
        n: clean.length,
        window_days: WINDOW_DAYS,
      },
    ]);
    anyOk = true;
  }
  if (!anyOk) return null;
  return Object.fromEntries(entries);
}

function round(n: number, d: number): number {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}
