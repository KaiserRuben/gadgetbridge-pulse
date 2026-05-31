import "server-only";

import { getWritableDb } from "../db-writable";

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

export function listPatterns(limit = 50): PatternEntry[] {
  // Use the writable handle so this read always sees uncommitted-but-visible
  // WAL frames from in-process writers — important right after upsertPattern,
  // where the Mac runner would otherwise miss its own write and emit a
  // duplicate upsert on the next pattern-naming pass.
  const conn = getWritableDb();
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

export function upsertPattern(
  entry: Omit<PatternEntry, "occurrence_count" | "user_confirmed">,
): PatternEntry {
  const conn = getWritableDb();
  const tx = conn.transaction(() => {
    const existing = conn
      .prepare<[string], Row>(
        `SELECT id FROM PULSE_PATTERN_LIBRARY WHERE id = ?`,
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
      // First-seen insert: name_de must be non-empty (the UPDATE branch lets
      // bumps pass "" because the stored name is what we keep).
      if (!entry.name_de) {
        throw new Error(
          `upsertPattern INSERT requires non-empty name_de for new id=${entry.id}`,
        );
      }
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

/**
 * Bump occurrence_count + refresh last_seen on an existing pattern. Returns
 * the fresh row, or null if the id is unknown (caller should fall back to
 * upsertPattern for a first-seen insert).
 *
 * Separate from upsertPattern so callers don't ship empty `name_de` /
 * `signature_json` placeholders just to satisfy the wider Omit<PatternEntry>
 * shape — those fields were dead on the UPDATE path and the Pi's route
 * validator used to 400 on them.
 */
export function bumpPattern(id: string, last_seen: string): PatternEntry | null {
  const conn = getWritableDb();
  const r = conn
    .prepare<[string, string]>(
      `UPDATE PULSE_PATTERN_LIBRARY
          SET last_seen = ?, occurrence_count = occurrence_count + 1
        WHERE id = ?`,
    )
    .run(last_seen, id);
  if (r.changes === 0) return null;
  const fresh = conn
    .prepare<[string], Row>(
      `SELECT id, name_de, description_de, signature_json, first_seen,
              last_seen, occurrence_count, user_confirmed
       FROM PULSE_PATTERN_LIBRARY WHERE id = ?`,
    )
    .get(id);
  return fresh ? rowToEntry(fresh) : null;
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

