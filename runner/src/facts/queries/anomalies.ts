/**
 * Date-windowed data anomalies — pure descriptive facts (NO rule decisions).
 *
 * Per PM resolution: facts.json must NOT carry rule decisions. We only
 * surface raw counts and stable note IDs that the runner already needs to
 * be aware of (firmware quirks). The rule engine + LLM stages decide what
 * to do with these counts.
 */

import type Database from "better-sqlite3";
import type { DayWindow } from "../window.ts";

export interface AnomalyFactsRaw {
  hr_overflow_rows: number;
  negative_step_rows: number;
  data_notes: string[];
}

const STABLE_DATA_NOTES = [
  "calorie-unit",
  "distance-scale",
  "minute-double",
] as const;

export function queryAnomalies(db: Database.Database, win: DayWindow): AnomalyFactsRaw {
  const overflow = db
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND HEART_RATE < 0 AND HEART_RATE != -1
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(win.startSec as number, win.endSec as number);

  const negSteps = db
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND STEPS < 0 AND STEPS != -1
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(win.startSec as number, win.endSec as number);

  return {
    hr_overflow_rows: overflow?.n ?? 0,
    negative_step_rows: negSteps?.n ?? 0,
    data_notes: [...STABLE_DATA_NOTES],
  };
}
