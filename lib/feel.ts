import "server-only";

import { pulseDb } from "./pulse-db";
import { getWritableDb } from "./db-writable";

/**
 * PULSE_FEEL_LOG — subjective 1..5 self-rating with optional note.
 */

export interface FeelEntry {
  id: number;
  ts_iso: string;
  feel: number;
  note: string | null;
  source: string;
}

interface Row {
  id: number;
  ts_iso: string;
  feel: number;
  note: string | null;
  source: string;
}

const PROBE_FILTER = `source != 'probe' AND (note IS NULL OR (note != 'probe' AND note NOT LIKE 'probe %' AND note NOT LIKE '%probe%smoke%' AND note NOT LIKE 'smoke probe%' AND note NOT LIKE 'probe-%'))`;

export function readFeel(sinceIso?: string, limit = 100): FeelEntry[] {
  const conn = pulseDb();
  if (!conn) return [];
  const rows = sinceIso
    ? conn
        .prepare<[string, number], Row>(
          `SELECT id, ts_iso, feel, note, source
           FROM PULSE_FEEL_LOG
           WHERE ts_iso >= ?
             AND ${PROBE_FILTER}
           ORDER BY ts_iso DESC
           LIMIT ?`,
        )
        .all(sinceIso, limit)
    : conn
        .prepare<[number], Row>(
          `SELECT id, ts_iso, feel, note, source
           FROM PULSE_FEEL_LOG
           WHERE ${PROBE_FILTER}
           ORDER BY ts_iso DESC
           LIMIT ?`,
        )
        .all(limit);
  return rows;
}

export function writeFeel(entry: Omit<FeelEntry, "id">): FeelEntry {
  const conn = getWritableDb();
  const stmt = conn.prepare<[string, number, string | null, string]>(
    `INSERT INTO PULSE_FEEL_LOG (ts_iso, feel, note, source)
     VALUES (?, ?, ?, ?)`,
  );
  const info = stmt.run(entry.ts_iso, entry.feel, entry.note, entry.source);
  return { id: Number(info.lastInsertRowid), ...entry };
}
