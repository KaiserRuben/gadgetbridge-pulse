/**
 * Date-windowed activity facts: steps, active minutes, calories, distance.
 *
 * Notes:
 *   - HUAWEI_ACTIVITY_SAMPLE.TIMESTAMP in UNIX SECONDS.
 *   - Sentinel rows (STEPS = -1) are excluded; their count is exposed for
 *     anomaly reporting.
 *   - Calories are firmware-scaled: firmware_unit / 1000 ≈ active kcal. Verified
 *     against workout-summary kcal: 5-9 workout windows had fw_sum 2 297 624 vs
 *     workout-summary 2 445 kcal (~6% off); sedentary days 100–400, hike days
 *     2 500+, all plausible. This is *active* kcal, not TEE — BMR not included.
 *   - Distance is stored in **metres** on this device (GT 5 Pro), despite the
 *     historical CLAUDE.md note claiming cm. Verified by cross-checking
 *     workout-summary distances and step counts:
 *       5546 steps → 3164 m raw, 0.57 m/step (rest day, partial coverage)
 *       24427 steps → 16535 m raw, 0.68 m/step (matches workout-summary km)
 *     We surface the raw SUM directly as `distance_m`.
 */

import type Database from "better-sqlite3";
import type { DayWindow } from "../window.ts";

export interface ActivityFactsRaw {
  metrics: {
    steps: number | null;
    active_minutes: number | null;
    sedentary_minutes: number | null;
    calories_kcal: number | null;
    distance_m: number | null;
  };
  rowCount: number;
}

const STEP_THRESHOLD_ACTIVE = 30;
const STEP_THRESHOLD_SEDENTARY = 1;

export function queryActivity(db: Database.Database, win: DayWindow): ActivityFactsRaw {
  const r = db
    .prepare<
      [number, number],
      {
        steps: number | null;
        cal: number | null;
        active: number | null;
        sed: number | null;
        dist_m: number | null;
        rows: number;
      }
    >(
      `SELECT
         COALESCE(SUM(CASE WHEN STEPS > 0 THEN STEPS ELSE 0 END), 0)         AS steps,
         COALESCE(SUM(CASE WHEN CALORIES > 0 THEN CALORIES ELSE 0 END), 0)   AS cal,
         SUM(CASE WHEN STEPS >= ${STEP_THRESHOLD_ACTIVE} THEN 1 ELSE 0 END)  AS active,
         SUM(CASE WHEN STEPS BETWEEN 0 AND ${STEP_THRESHOLD_SEDENTARY - 1} THEN 1 ELSE 0 END) AS sed,
         COALESCE(SUM(CASE WHEN DISTANCE > 0 THEN DISTANCE ELSE 0 END), 0)   AS dist_m,
         COUNT(*) AS rows
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(win.startSec as number, win.endSec as number);

  if (!r) {
    return {
      metrics: {
        steps: null,
        active_minutes: null,
        sedentary_minutes: null,
        calories_kcal: null,
        distance_m: null,
      },
      rowCount: 0,
    };
  }

  const distanceM =
    r.dist_m !== null && r.dist_m !== undefined && r.dist_m > 0
      ? Math.round(r.dist_m)
      : 0;

  return {
    metrics: {
      steps: r.steps ?? 0,
      active_minutes: r.active ?? 0,
      sedentary_minutes: r.sed ?? 0,
      calories_kcal: r.cal !== null && r.cal !== undefined ? Math.round(r.cal / 1000) : null,
      distance_m: distanceM,
    },
    rowCount: r.rows ?? 0,
  };
}
