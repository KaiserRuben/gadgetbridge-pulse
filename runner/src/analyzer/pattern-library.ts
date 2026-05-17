/**
 * PULSE_PATTERN_LIBRARY — Phase 3 pattern naming.
 *
 * Each pattern is keyed by a stable hash of its normalized signature. The
 * runner upserts here when it detects a recurring pattern: increments
 * `occurrence_count`, refreshes `last_seen`, leaves `name_de` /
 * `description_de` / `user_confirmed` alone.
 *
 * `markPatternConfirmed` is the user-action path — server actions on the
 * Next.js side will eventually expose it, but for now the runner can call
 * it directly during smoke tests.
 *
 * Reads use the runner's read-only handle; writes use the writable handle.
 */

import { pulseDb } from "../pulse-db.ts";
import { getWritableDb } from "../db-writable.ts";

export interface PatternEntry {
  id: string;
  name_de: string;
  description_de: string | null;
  signature_json: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  user_confirmed: boolean;
}

interface Row {
  id: string;
  name_de: string;
  description_de: string | null;
  signature_json: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  user_confirmed: number;
}

function rowToEntry(r: Row): PatternEntry {
  return {
    id: r.id,
    name_de: r.name_de,
    description_de: r.description_de,
    signature_json: r.signature_json,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    occurrence_count: r.occurrence_count,
    user_confirmed: r.user_confirmed === 1,
  };
}

export function readPatterns(limit = 50): PatternEntry[] {
  const conn = pulseDb();
  if (!conn) return [];
  const rows = conn
    .prepare<[number], Row>(
      `SELECT id, name_de, description_de, signature_json, first_seen,
              last_seen, occurrence_count, user_confirmed
       FROM PULSE_PATTERN_LIBRARY
       ORDER BY last_seen DESC
       LIMIT ?`,
    )
    .all(limit);
  return rows.map(rowToEntry);
}

/**
 * Upsert a pattern. If id exists: bump occurrence_count, refresh last_seen,
 * keep name/description/user_confirmed untouched. If new: insert with
 * occurrence_count=1, user_confirmed=0.
 */
export function upsertPattern(
  entry: Omit<PatternEntry, "occurrence_count" | "user_confirmed">,
): PatternEntry {
  const conn = getWritableDb();
  const tx = conn.transaction(() => {
    const existing = conn
      .prepare<[string], Row>(
        `SELECT id, name_de, description_de, signature_json, first_seen,
                last_seen, occurrence_count, user_confirmed
         FROM PULSE_PATTERN_LIBRARY WHERE id = ?`,
      )
      .get(entry.id);

    if (existing) {
      conn
        .prepare<[string, string]>(
          `UPDATE PULSE_PATTERN_LIBRARY
           SET last_seen = ?, occurrence_count = occurrence_count + 1
           WHERE id = ?`,
        )
        .run(entry.last_seen, entry.id);
    } else {
      conn
        .prepare<[string, string, string | null, string, string, string]>(
          `INSERT INTO PULSE_PATTERN_LIBRARY
             (id, name_de, description_de, signature_json, first_seen, last_seen,
              occurrence_count, user_confirmed)
           VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
        )
        .run(
          entry.id,
          entry.name_de,
          entry.description_de,
          entry.signature_json,
          entry.first_seen,
          entry.last_seen,
        );
    }
  });
  tx();

  const fresh = conn
    .prepare<[string], Row>(
      `SELECT id, name_de, description_de, signature_json, first_seen,
              last_seen, occurrence_count, user_confirmed
       FROM PULSE_PATTERN_LIBRARY WHERE id = ?`,
    )
    .get(entry.id);
  if (!fresh) throw new Error(`upsertPattern: row missing after upsert id=${entry.id}`);
  return rowToEntry(fresh);
}

export function markPatternConfirmed(id: string, name_de?: string): void {
  const conn = getWritableDb();
  if (name_de !== undefined) {
    conn
      .prepare<[string, string]>(
        `UPDATE PULSE_PATTERN_LIBRARY
         SET user_confirmed = 1, name_de = ?
         WHERE id = ?`,
      )
      .run(name_de, id);
  } else {
    conn
      .prepare<[string]>(
        `UPDATE PULSE_PATTERN_LIBRARY
         SET user_confirmed = 1
         WHERE id = ?`,
      )
      .run(id);
  }
}
