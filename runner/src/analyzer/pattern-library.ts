/**
 * PULSE_PATTERN_LIBRARY — HTTP shim over Pi /api/patterns/*.
 *
 * Reads list patterns from Pi (GET /api/patterns/list); writes upsert /
 * confirm via POST. The runner's previous direct SQLite write path is gone
 * — Pi is the single writer of pulse.db.
 */

import {
  piPatternBump,
  piPatternConfirm,
  piPatternList,
  piPatternUpsert,
  type PatternEntry as PiPatternEntry,
} from "../ingest/client.ts";

export type PatternEntry = PiPatternEntry;

export async function readPatterns(limit = 50): Promise<PatternEntry[]> {
  return piPatternList(limit);
}

/**
 * First-seen insert of a pattern. Returns the fresh row, or null if the Pi
 * was unreachable. Caller is responsible for using `bumpPattern` instead
 * when the pattern already exists — upsertPattern's INSERT path requires a
 * non-empty name_de and 400s/throws otherwise.
 */
export async function upsertPattern(
  entry: Omit<PatternEntry, "occurrence_count" | "user_confirmed">,
): Promise<PatternEntry | null> {
  return piPatternUpsert(entry);
}

/**
 * Bump occurrence_count + last_seen for an existing pattern. The bare two-
 * field call replaces the prior `upsertPattern({ name_de:"", description_de:null, ... })`
 * shape which 400'd on the Pi route's required-field validation.
 */
export async function bumpPattern(id: string, last_seen: string): Promise<PatternEntry | null> {
  return piPatternBump(id, last_seen);
}

export async function markPatternConfirmed(id: string, name_de?: string): Promise<boolean> {
  return piPatternConfirm(id, name_de);
}
