/**
 * German → English food-query translation cache.
 *
 * Stage B's USDA grounding hop needs an English search term. The translation
 * is cheap and one-shot per food_key, so we:
 *
 *   1. Read `en_query` from PULSE_FOOD_NUTRITION via Syncthing-replicated
 *      pulse.db. If present → done.
 *   2. Miss → call ministral-3:3b (text-only, German→English) for a 1–4 word
 *      USDA-friendly search query.
 *   3. Same-run cache absorbs intra-process repeats. The disk row gets
 *      written by `enrich.ts` after a successful USDA hit (so we don't
 *      pollute the table with translations that never grounded anything).
 *
 * Returns `label_de` verbatim on any LLM failure — USDA will probably miss
 * on the German term, the cascade will fall through to OFF or LLM, the
 * pipeline never blocks on translation.
 */

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { pulseDb } from "../../pulse-db.ts";

/** Same-run cache: food_key → en_query. */
const memCache = new Map<string, string>();

const TRANSLATE_MODEL = process.env.PULSE_TRANSLATE_MODEL ?? "ministral-3:3b";
const TIMEOUT_MS = 300_000;

const PROMPT = `Translate this German food name to a 1–4 word English search query for USDA FoodData Central. Return only the query, no quotes, no punctuation.

Examples:
- "Kichererbsen gekocht" → chickpeas cooked
- "Vollkornbrot" → whole grain bread
- "Hähnchenbrust gegrillt" → grilled chicken breast
- "Joghurt natur" → plain yogurt

Input:`;

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
}

function lookupDbEnQuery(food_key: string): string | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], { en_query: string | null }>(
        `SELECT en_query FROM PULSE_FOOD_NUTRITION WHERE food_key = ?`,
      )
      .get(food_key);
    return row?.en_query?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Translate a German food label to an English search query suitable for
 * USDA FoodData Central. Cache-first; falls back to the German label on
 * LLM failure so the caller can still attempt a search (will usually miss,
 * but the cascade tolerates that).
 */
export async function translateFoodKey(
  food_key: string,
  label_de: string,
): Promise<string> {
  const memHit = memCache.get(food_key);
  if (memHit) return memHit;

  const dbHit = lookupDbEnQuery(food_key);
  if (dbHit) {
    memCache.set(food_key, dbHit);
    return dbHit;
  }

  const userContent = `${PROMPT}\n"${label_de.replace(/"/g, '\\"')}"`;
  const body = {
    model: TRANSLATE_MODEL,
    stream: false,
    messages: [{ role: "user" as const, content: userContent }],
    options: { temperature: 0.1, num_predict: 32, num_ctx: 2048 },
  };
  const url = `${config.ollamaUrl.replace(/\/+$/, "")}/api/chat`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn("nutrition", `translateFoodKey ${food_key}: HTTP ${res.status}`);
      return label_de;
    }
    const json = (await res.json()) as OllamaChatResponse;
    const raw = json.message?.content?.trim();
    if (!raw) {
      log.warn(
        "nutrition",
        `translateFoodKey ${food_key}: empty content (done_reason=${json.done_reason})`,
      );
      return label_de;
    }
    // Strip stray quotes / trailing punctuation. Cap at 60 chars — defensive.
    const cleaned = raw
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?,;:]+$/g, "")
      .split("\n")[0]
      .trim()
      .slice(0, 60);
    if (!cleaned) return label_de;
    memCache.set(food_key, cleaned);
    return cleaned;
  } catch (err) {
    log.warn(
      "nutrition",
      `translateFoodKey ${food_key}: ${err instanceof Error ? err.message : err}`,
    );
    return label_de;
  }
}

/** Test seam — drop the in-process cache. Production never calls this. */
export function _resetTranslateCache(): void {
  memCache.clear();
}
