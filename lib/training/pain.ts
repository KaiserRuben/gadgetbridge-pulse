import "server-only";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";
import type { TrainingPainFlagV1 } from "../types/generated";

/**
 * Pain-flag persistence.
 *
 * `location_code` + `side` are the enum-bound aggregation keys (see
 * pain-flag.schema.json, docs/TRAINING_PLAN_DESIGN.md §Q3). `free_text` is
 * verbatim user input — surfaced to the LLM only in per-flag zoom-in
 * contexts, echoed-verbatim-or-omit, never paraphrased.
 */

export interface PainFlagRow {
  id: number;
  actual_session_id: string;
  exercise_id: string | null;
  set_log_id: number | null;
  location_code: TrainingPainFlagV1["location_code"];
  side: TrainingPainFlagV1["side"];
  severity: TrainingPainFlagV1["severity"];
  free_text: string | null;
  raised_at: string;
}

interface PainFlagRawRow extends Omit<PainFlagRow, "location_code" | "side" | "severity"> {
  location_code: string;
  side: string;
  severity: string;
}

const SELECT_COLUMNS = `
  id, actual_session_id, exercise_id, set_log_id, location_code, side, severity,
  free_text, raised_at
`;

function rowToFlag(r: PainFlagRawRow): PainFlagRow {
  return {
    ...r,
    location_code: r.location_code as PainFlagRow["location_code"],
    side: r.side as PainFlagRow["side"],
    severity: r.severity as PainFlagRow["severity"],
  };
}

export function listPainForSession(sessionId: string): PainFlagRow[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<[string], PainFlagRawRow>(
        `SELECT ${SELECT_COLUMNS} FROM PULSE_PAIN_FLAG WHERE actual_session_id = ? ORDER BY raised_at ASC`,
      )
      .all(sessionId);
    return rows.map(rowToFlag);
  } catch {
    return [];
  }
}

export interface RecurrenceQuery {
  location_code: TrainingPainFlagV1["location_code"];
  side?: TrainingPainFlagV1["side"];
  since_iso: string;
}

export function countRecurrence(q: RecurrenceQuery): number {
  const db = pulseDb();
  if (!db) return 0;
  try {
    if (q.side) {
      const row = db
        .prepare<[string, string, string], { c: number }>(
          `SELECT COUNT(*) AS c FROM PULSE_PAIN_FLAG
           WHERE location_code = ? AND side = ? AND raised_at >= ?`,
        )
        .get(q.location_code, q.side, q.since_iso);
      return row?.c ?? 0;
    }
    const row = db
      .prepare<[string, string], { c: number }>(
        `SELECT COUNT(*) AS c FROM PULSE_PAIN_FLAG
         WHERE location_code = ? AND raised_at >= ?`,
      )
      .get(q.location_code, q.since_iso);
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export interface RaisePainInput {
  actual_session_id: string;
  exercise_id?: string | null;
  set_log_id?: number | null;
  location_code: TrainingPainFlagV1["location_code"];
  side: TrainingPainFlagV1["side"];
  severity: TrainingPainFlagV1["severity"];
  free_text?: string | null;
  raised_at?: string;
}

export function raisePain(input: RaisePainInput): PainFlagRow {
  const db = getWritableDb();
  const info = db
    .prepare(
      `INSERT INTO PULSE_PAIN_FLAG
         (actual_session_id, exercise_id, set_log_id, location_code, side, severity, free_text, raised_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.actual_session_id,
      input.exercise_id ?? null,
      input.set_log_id ?? null,
      input.location_code,
      input.side,
      input.severity,
      input.free_text ?? null,
      input.raised_at ?? new Date().toISOString(),
    );
  const id = Number(info.lastInsertRowid);
  const row = db
    .prepare<[number], PainFlagRawRow>(`SELECT ${SELECT_COLUMNS} FROM PULSE_PAIN_FLAG WHERE id = ?`)
    .get(id);
  if (!row) throw new Error("pain flag vanished after insert");
  return rowToFlag(row);
}
