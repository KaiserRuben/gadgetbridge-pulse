import "server-only";

import { pulseDb } from "./pulse-db";
import { getWritableDb } from "./db-writable";

/**
 * PULSE_JOURNAL_ENTRY — free-text journaling with optional mood + tags.
 *
 * Tags are stored as a JSON array string in the `tags` column. Readers
 * parse it back into a `string[]`; writers serialise.
 */

export interface JournalEntry {
  id: number;
  ts_iso: string;
  text: string | null;
  mood: number | null;
  tags: string[];
  source: string;
}

interface Row {
  id: number;
  ts_iso: string;
  text: string | null;
  mood: number | null;
  tags: string;
  source: string;
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((t): t is string => typeof t === "string")) {
      return parsed;
    }
  } catch {
    /* fallthrough */
  }
  return [];
}

const PROBE_FILTER = `source != 'probe' AND (text IS NULL OR (text NOT LIKE '%probe-db-write%' AND text NOT LIKE 'smoke probe entry%'))`;

export function readJournal(sinceIso?: string, limit = 100): JournalEntry[] {
  const conn = pulseDb();
  if (!conn) return [];
  const rows = sinceIso
    ? conn
        .prepare<[string, number], Row>(
          `SELECT id, ts_iso, text, mood, tags, source
           FROM PULSE_JOURNAL_ENTRY
           WHERE ts_iso >= ?
             AND ${PROBE_FILTER}
           ORDER BY ts_iso DESC
           LIMIT ?`,
        )
        .all(sinceIso, limit)
    : conn
        .prepare<[number], Row>(
          `SELECT id, ts_iso, text, mood, tags, source
           FROM PULSE_JOURNAL_ENTRY
           WHERE ${PROBE_FILTER}
           ORDER BY ts_iso DESC
           LIMIT ?`,
        )
        .all(limit);
  return rows.map((r) => ({
    id: r.id,
    ts_iso: r.ts_iso,
    text: r.text,
    mood: r.mood,
    tags: parseTags(r.tags),
    source: r.source,
  }));
}

export function writeJournal(entry: Omit<JournalEntry, "id">): JournalEntry {
  const conn = getWritableDb();
  const stmt = conn.prepare<
    [string, string | null, number | null, string, string]
  >(
    `INSERT INTO PULSE_JOURNAL_ENTRY (ts_iso, text, mood, tags, source)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    entry.ts_iso,
    entry.text,
    entry.mood,
    JSON.stringify(entry.tags),
    entry.source,
  );
  return { id: Number(info.lastInsertRowid), ...entry };
}
