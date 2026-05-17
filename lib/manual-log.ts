import "server-only";

import { pulseDb } from "./pulse-db";
import { getWritableDb } from "./db-writable";

/**
 * PULSE_MANUAL_LOG — user-supplied scalar metrics (weight, body fat, …).
 *
 * Lives in pulse.db (the Pulse-owned sidecar), NOT Gadgetbridge.db. Reads use
 * the readonly pulse.db handle; writes go through the writable handle. Only
 * call `writeManualLog` from a server action or route handler.
 *
 * If pulse.db does not yet exist (e.g. brand-new install before the writable
 * handle has been opened), `readManualLog` returns `[]` rather than throwing.
 */

export interface ManualLogEntry {
  id: number;
  ts_iso: string;
  metric: string;
  value: number;
  unit: string;
  source: string;
  note: string | null;
}

interface Row {
  id: number;
  ts_iso: string;
  metric: string;
  value: number;
  unit: string;
  source: string;
  note: string | null;
}

const PROBE_NOTE_FILTER = `source != 'probe' AND (note IS NULL OR (note NOT LIKE 'probe-db-write%' AND note NOT LIKE 'probe-log-write%' AND note NOT LIKE 'smoke probe entry%' AND note NOT LIKE '%probe-patterns-smoke%'))`;

export function readManualLog(metric?: string, limit = 100): ManualLogEntry[] {
  const conn = pulseDb();
  if (!conn) return [];
  const rows = metric
    ? conn
        .prepare<[string, number], Row>(
          `SELECT id, ts_iso, metric, value, unit, source, note
           FROM PULSE_MANUAL_LOG
           WHERE metric = ?
             AND ${PROBE_NOTE_FILTER}
           ORDER BY ts_iso DESC
           LIMIT ?`,
        )
        .all(metric, limit)
    : conn
        .prepare<[number], Row>(
          `SELECT id, ts_iso, metric, value, unit, source, note
           FROM PULSE_MANUAL_LOG
           WHERE ${PROBE_NOTE_FILTER}
           ORDER BY ts_iso DESC
           LIMIT ?`,
        )
        .all(limit);
  return rows;
}

export function writeManualLog(entry: Omit<ManualLogEntry, "id">): ManualLogEntry {
  const conn = getWritableDb();
  const stmt = conn.prepare<
    [string, string, number, string, string, string | null]
  >(
    `INSERT INTO PULSE_MANUAL_LOG (ts_iso, metric, value, unit, source, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    entry.ts_iso,
    entry.metric,
    entry.value,
    entry.unit,
    entry.source,
    entry.note,
  );
  return { id: Number(info.lastInsertRowid), ...entry };
}
