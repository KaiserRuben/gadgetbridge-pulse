/**
 * DB-backed food-nutrition cache.
 *
 * Stage B's LLM fallback writes per-100g nutrition for previously unseen
 * food_keys. Persisting those rows in PULSE_FOOD_NUTRITION lets the runner
 * skip the LLM call on repeats — across restarts, across reboots, across
 * model swaps. The seed table is canonical; the LLM cache layer is additive.
 *
 * The runner reads pulse.db over Syncthing. Writes go through the Pi via
 * pushFood → /api/ingest/food (single-writer rule).
 */

import type Database from "better-sqlite3";

import { pulseDb } from "../../pulse-db.ts";
import type { NutritionFacts } from "../types.ts";

export interface CachedFood {
  food_key: string;
  per100g: NutritionFacts;
  label: string | null;
  source: "seed" | "llm";
  model: string | null;
  captured_at: string;
}

interface Row {
  food_key: string;
  label: string | null;
  source: "seed" | "llm";
  model: string | null;
  per_100g_json: string;
  captured_at: string;
}

function decode(row: Row): CachedFood | null {
  try {
    const per100g = JSON.parse(row.per_100g_json) as NutritionFacts;
    return {
      food_key: row.food_key,
      label: row.label,
      source: row.source,
      model: row.model,
      captured_at: row.captured_at,
      per100g,
    };
  } catch {
    return null;
  }
}

/** Single lookup. Returns null when pulse.db is missing or the row isn't there. */
export function lookupCachedFood(foodKey: string): CachedFood | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], Row>(
        `SELECT food_key, label, source, model, per_100g_json, captured_at
         FROM PULSE_FOOD_NUTRITION WHERE food_key = ?`,
      )
      .get(foodKey);
    return row ? decode(row) : null;
  } catch {
    // Table missing on a fresh deploy before migrations ran — degrade silently.
    return null;
  }
}

/** All cached keys. Used by enrich.ts for fuzzy matching across the cache. */
export function listCachedKeys(): string[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = (db as Database.Database)
      .prepare<[], { food_key: string }>(`SELECT food_key FROM PULSE_FOOD_NUTRITION`)
      .all();
    return rows.map((r) => r.food_key);
  } catch {
    return [];
  }
}
