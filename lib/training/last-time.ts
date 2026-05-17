import "server-only";

import { pulseDb } from "../pulse-db";
import type { SetLogRow } from "./set-log";

/**
 * For the in-session "last time" comparison: latest non-stale set per
 * (exercise_id, set_idx) across the user's history. Caller passes the
 * list of exercise_ids in the session template; the helper returns a map
 * of exercise_id → last-time set rows sorted by set_idx so the runner UI
 * can render "letzte Session: 3×10 @ 12 kg, RPE 6" inline.
 */

interface Row {
  exercise_id: string;
  set_idx: number;
  reps: number | null;
  weight_kg: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  rpe: number | null;
  rir: number | null;
  side: string | null;
  note: string | null;
  logged_at: string;
  actual_session_id: string;
}

export type LastTimeSet = Pick<
  SetLogRow,
  | "exercise_id"
  | "set_idx"
  | "reps"
  | "weight_kg"
  | "duration_sec"
  | "distance_m"
  | "rpe"
  | "rir"
  | "side"
  | "note"
  | "logged_at"
  | "actual_session_id"
>;

export function lastTimeByExercise(
  exerciseIds: string[],
  opts: { excludeSessionId?: string } = {},
): Record<string, LastTimeSet[]> {
  if (exerciseIds.length === 0) return {};
  const db = pulseDb();
  if (!db) return {};
  const placeholders = exerciseIds.map(() => "?").join(",");
  try {
    // For each exercise_id, pull every set from the most-recent session that
    // logged it (excluding the current session if provided). Group by
    // (exercise_id, set_idx) and rank within exercise so set_idx ordering
    // matches the row in the in-session view.
    const sql = `
      WITH latest_session_per_exercise AS (
        SELECT exercise_id, MAX(actual_session_id) AS pick_session
        FROM (
          SELECT s.exercise_id, s.actual_session_id, MAX(s.logged_at) AS recent_log
          FROM PULSE_SET_LOG s
          WHERE s.exercise_id IN (${placeholders})
            ${opts.excludeSessionId ? "AND s.actual_session_id != ?" : ""}
          GROUP BY s.exercise_id, s.actual_session_id
          ORDER BY recent_log DESC
        )
        GROUP BY exercise_id
      )
      SELECT s.exercise_id, s.set_idx, s.reps, s.weight_kg, s.duration_sec, s.distance_m,
             s.rpe, s.rir, s.side, s.note, s.logged_at, s.actual_session_id
      FROM PULSE_SET_LOG s
      JOIN latest_session_per_exercise l
        ON l.exercise_id = s.exercise_id AND l.pick_session = s.actual_session_id
      ORDER BY s.exercise_id, s.set_idx
    `;
    const params: (string | number)[] = [...exerciseIds];
    if (opts.excludeSessionId) params.push(opts.excludeSessionId);
    const rows = db.prepare<(string | number)[], Row>(sql).all(...params);
    const out: Record<string, LastTimeSet[]> = {};
    for (const r of rows) {
      const list = out[r.exercise_id] ?? [];
      list.push({
        exercise_id: r.exercise_id,
        set_idx: r.set_idx,
        reps: r.reps,
        weight_kg: r.weight_kg,
        duration_sec: r.duration_sec,
        distance_m: r.distance_m,
        rpe: r.rpe,
        rir: r.rir,
        side: r.side as SetLogRow["side"],
        note: r.note,
        logged_at: r.logged_at,
        actual_session_id: r.actual_session_id,
      });
      out[r.exercise_id] = list;
    }
    return out;
  } catch {
    return {};
  }
}
