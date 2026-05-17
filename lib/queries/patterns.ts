import "server-only";
import { pulseDb } from "../pulse-db";

/**
 * Read-side accessor for `PULSE_PATTERN_LIBRARY` — populated by the runner's
 * stage5b_patterns. The dashboard uses this on `/explore/patterns` to render
 * recurring multi-metric signature cards. No write path here; users can
 * confirm a pattern via a server action that calls into the runner module.
 */
export type PatternRow = {
  id: string;
  name_de: string;
  description_de: string | null;
  signature_json: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  user_confirmed: boolean;
};

interface PatternRowRaw {
  id: string;
  name_de: string;
  description_de: string | null;
  signature_json: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  user_confirmed: number;
}

/** Newest-last-seen first. Returns [] if pulse.db or the table is missing. */
export function getPatterns(limit = 50): PatternRow[] {
  try {
    const conn = pulseDb();
    if (!conn) return [];
    const rows = conn
      .prepare<[number], PatternRowRaw>(
        `SELECT id, name_de, description_de, signature_json, first_seen,
                last_seen, occurrence_count, user_confirmed
         FROM PULSE_PATTERN_LIBRARY
         ORDER BY last_seen DESC, occurrence_count DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows.map((r) => ({
      id: r.id,
      name_de: r.name_de,
      description_de: r.description_de,
      signature_json: r.signature_json,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      occurrence_count: r.occurrence_count,
      user_confirmed: r.user_confirmed === 1,
    }));
  } catch {
    return [];
  }
}

export type PatternSignature = {
  centroid?: Record<string, number>;
  salient_flags?: string[];
  member_dates?: string[];
};

/** Decode signature_json with a tolerant parser. Returns {} on miss. */
export function parsePatternSignature(json: string): PatternSignature {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as PatternSignature;
  } catch {
    return {};
  }
}
