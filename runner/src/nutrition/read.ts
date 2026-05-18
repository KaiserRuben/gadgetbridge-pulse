/**
 * Mac-side reader for nutrition rows in pulse.db.
 *
 * Pulse.db is Pi-writer / Mac-reader through Syncthing. We only ever read
 * here; the watcher + orchestrator persist via the HTTP ingest path.
 * Better-sqlite3 in read-only mode tolerates the Syncthing replication
 * just fine as long as we never open a writable handle from the runner.
 */

import Database from "better-sqlite3";

import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { ProvenanceTag } from "../jobs/types.ts";
import type {
  MealComponent,
  MealKind,
  NutritionFacts,
  NutritionSnapshot,
} from "./types.ts";

export interface StoredMeal {
  id: string;
  user_meal_at: string;
  period_key: string;
  photo_path: string | null;
  user_text: string | null;
  status: "pending" | "classified" | "edited" | "failed";
  kind: MealKind;
  classified_at: string | null;
  totals: NutritionFacts;
  components: MealComponent[];
}

interface MealRow {
  id: string;
  user_meal_at: string;
  period_key: string;
  photo_path: string | null;
  user_text: string | null;
  status: StoredMeal["status"];
  kind: MealKind;
  classified_at: string | null;
  totals_json: string;
}

interface ComponentRow {
  id: string;
  meal_id: string;
  ord: number;
  food_key: string;
  label: string;
  grams: number;
  confidence: number | null;
  source: MealComponent["source"];
  nutrition_json: string;
  provenance_json: string | null;
}

let cachedDb: Database.Database | null = null;
function db(): Database.Database {
  if (cachedDb) return cachedDb;
  cachedDb = new Database(config.pulseDbPath, { readonly: true, fileMustExist: true });
  return cachedDb;
}

function parseJSON<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_TOTALS: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
const EMPTY_SNAPSHOT: NutritionSnapshot = { per100g: EMPTY_TOTALS, totals: EMPTY_TOTALS };

function hydrate(row: MealRow, components: ComponentRow[]): StoredMeal {
  return {
    id: row.id,
    user_meal_at: row.user_meal_at,
    period_key: row.period_key,
    photo_path: row.photo_path,
    user_text: row.user_text,
    status: row.status,
    kind: row.kind,
    classified_at: row.classified_at,
    totals: parseJSON(row.totals_json, EMPTY_TOTALS),
    components: components
      .sort((a, b) => a.ord - b.ord)
      .map((c) => ({
        ord: c.ord,
        food_key: c.food_key,
        label: c.label,
        grams: c.grams,
        confidence: c.confidence,
        source: c.source,
        nutrition: parseJSON(c.nutrition_json, EMPTY_SNAPSHOT),
        provenance: c.provenance_json
          ? parseJSON<ProvenanceTag[]>(c.provenance_json, [])
          : [],
      })),
  };
}

export function readMealsForPeriod(periodKey: string): StoredMeal[] {
  try {
    const conn = db();
    const rows = conn
      .prepare<[string], MealRow>(
        `SELECT id, user_meal_at, period_key, photo_path, user_text, status, kind,
                classified_at, totals_json
         FROM PULSE_MEAL WHERE period_key = ? ORDER BY user_meal_at`,
      )
      .all(periodKey);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const comps = conn
      .prepare<string[], ComponentRow>(
        `SELECT id, meal_id, ord, food_key, label, grams, confidence, source, nutrition_json, provenance_json
         FROM PULSE_MEAL_COMPONENT WHERE meal_id IN (${placeholders}) ORDER BY meal_id, ord`,
      )
      .all(...ids);
    return rows.map((row) =>
      hydrate(
        row,
        comps.filter((c) => c.meal_id === row.id),
      ),
    );
  } catch (err) {
    log.error("nutrition", `readMealsForPeriod: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
