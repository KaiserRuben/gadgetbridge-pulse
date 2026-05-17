import "server-only";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";
import type { TrainingSetLogV1 } from "../types/generated";

/**
 * Set-log writes with edit audit.
 *
 * Edits to a finished set produce a `PULSE_SET_LOG_AUDIT` row preserving
 * the pre-edit JSON so the original numbers are recoverable. Insights that
 * cited the old values are marked stale by the runner on its next pass.
 */

export interface SetLogRow {
  id: number;
  actual_session_id: string;
  exercise_id: string;
  set_idx: number;
  reps: number | null;
  weight_kg: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  rpe: number | null;
  rir: number | null;
  side: TrainingSetLogV1["side"];
  note: string | null;
  logged_at: string;
  last_edited_at: string | null;
}

interface SetLogRawRow extends Omit<SetLogRow, "side"> {
  side: string | null;
}

const SELECT_COLUMNS = `
  id, actual_session_id, exercise_id, set_idx, reps, weight_kg, duration_sec, distance_m,
  rpe, rir, side, note, logged_at, last_edited_at
`;

function rowToSet(r: SetLogRawRow): SetLogRow {
  return { ...r, side: (r.side as SetLogRow["side"]) ?? null };
}

export function readSet(id: number): SetLogRow | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[number], SetLogRawRow>(
        `SELECT ${SELECT_COLUMNS} FROM PULSE_SET_LOG WHERE id = ?`,
      )
      .get(id);
    return row ? rowToSet(row) : null;
  } catch {
    return null;
  }
}

export function listSetsForSession(sessionId: string): SetLogRow[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<[string], SetLogRawRow>(
        `SELECT ${SELECT_COLUMNS} FROM PULSE_SET_LOG
         WHERE actual_session_id = ?
         ORDER BY set_idx ASC, id ASC`,
      )
      .all(sessionId);
    return rows.map(rowToSet);
  } catch {
    return [];
  }
}

export type SetLogInput = Omit<SetLogRow, "id" | "logged_at" | "last_edited_at"> & {
  logged_at?: string;
};

/**
 * Upsert a set log keyed on (actual_session_id, set_idx, exercise_id) so a
 * retried POST from a flaky client overwrites instead of duplicating. The
 * older logged value is preserved in PULSE_SET_LOG_AUDIT.
 */
export function upsertSet(input: SetLogInput): SetLogRow {
  const db = getWritableDb();
  const loggedAt = input.logged_at ?? new Date().toISOString();

  const existing = db
    .prepare<[string, number, string], { id: number; payload_json: string }>(
      `SELECT id, json_object(
         'reps', reps, 'weight_kg', weight_kg, 'duration_sec', duration_sec,
         'distance_m', distance_m, 'rpe', rpe, 'rir', rir, 'side', side, 'note', note
       ) AS payload_json
       FROM PULSE_SET_LOG
       WHERE actual_session_id = ? AND set_idx = ? AND exercise_id = ?`,
    )
    .get(input.actual_session_id, input.set_idx, input.exercise_id);

  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE PULSE_SET_LOG
         SET reps = ?, weight_kg = ?, duration_sec = ?, distance_m = ?,
             rpe = ?, rir = ?, side = ?, note = ?, last_edited_at = ?
         WHERE id = ?`,
      ).run(
        input.reps,
        input.weight_kg,
        input.duration_sec,
        input.distance_m,
        input.rpe,
        input.rir,
        input.side,
        input.note,
        new Date().toISOString(),
        existing.id,
      );
      db.prepare(
        `INSERT INTO PULSE_SET_LOG_AUDIT (set_log_id, before_json, after_json, source)
         VALUES (?, ?, json_object(
           'reps', ?, 'weight_kg', ?, 'duration_sec', ?, 'distance_m', ?,
           'rpe', ?, 'rir', ?, 'side', ?, 'note', ?
         ), 'user_edit')`,
      ).run(
        existing.id,
        existing.payload_json,
        input.reps,
        input.weight_kg,
        input.duration_sec,
        input.distance_m,
        input.rpe,
        input.rir,
        input.side,
        input.note,
      );
      return existing.id;
    }
    const info = db
      .prepare(
        `INSERT INTO PULSE_SET_LOG
           (actual_session_id, exercise_id, set_idx, reps, weight_kg, duration_sec, distance_m,
            rpe, rir, side, note, logged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.actual_session_id,
        input.exercise_id,
        input.set_idx,
        input.reps,
        input.weight_kg,
        input.duration_sec,
        input.distance_m,
        input.rpe,
        input.rir,
        input.side,
        input.note,
        loggedAt,
      );
    return Number(info.lastInsertRowid);
  });

  const id = tx();
  const row = readSet(id);
  if (!row) throw new Error("set vanished after upsert");
  return row;
}

export function deleteSet(id: number): boolean {
  const db = getWritableDb();
  const existing = readSet(id);
  if (!existing) return false;
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO PULSE_SET_LOG_AUDIT (set_log_id, before_json, after_json, source)
       VALUES (?, ?, NULL, 'delete')`,
    ).run(id, JSON.stringify(existing));
    db.prepare(`DELETE FROM PULSE_SET_LOG WHERE id = ?`).run(id);
  });
  tx();
  return true;
}
