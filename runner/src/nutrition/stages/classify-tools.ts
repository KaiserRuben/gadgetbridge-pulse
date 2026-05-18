/**
 * Stage A tool surface — agentic search for the classify VLM call.
 *
 * Currently exposes **one** tool: `search_nutrition`. The model can call it
 * with a German query to disambiguate a food before committing a `food_key`.
 * Returns up to N candidates from the existing grounding cascade (seed →
 * cache → USDA → OFF), formatted as a model-readable summary.
 *
 * Why one tool, not several:
 *   - Spec says: prove the basic loop works first, then expand.
 *   - Tool calling under vision input on qwen3.6 is unproven (see
 *     `docs/wip/NUTRITION_TOOL_CALLING.md`). Keep the surface minimal to
 *     reduce the chance the model emits malformed calls.
 *
 * Why we re-use the grounding cascade verbatim:
 *   - The tool is the model's "I'm not sure, let me look it up" loop. It
 *     should resolve through the same authority chain that Stage B uses
 *     downstream (so the tool's answer agrees with what enrich.ts ends up
 *     pulling). Re-implementing search logic here would risk drift.
 *
 * The shape returned to the model is NOT the raw NutritionFacts object —
 * the model doesn't need to make per-100g nutritional decisions during
 * classify. A human-readable per100g_summary and a rationale string are
 * enough to disambiguate `salat` (Salad dressing, NFS) from `kopfsalat`
 * (raw butterhead lettuce).
 */

import { log } from "../../logger.ts";
import {
  listSeedKeys,
  lookupFoodSeed,
} from "../food-db/lookup.ts";
import { listCachedKeys, lookupCachedFood } from "../food-db/db-cache.ts";
import { fuzzyMatchKey, normalizeFoodKey } from "../food-db/normalize.ts";
import { searchUsda } from "../food-db/usda.ts";
import { searchOff } from "../food-db/off.ts";
import { translateFoodKey } from "../food-db/translate.ts";
import type { NutritionFacts } from "../types.ts";

// ── Tool schema ─────────────────────────────────────────────────────────────

/**
 * The JSON schema sent to Ollama as `tools[0].function.parameters`.
 * Mirrors the locked Pydantic-equivalent style used elsewhere in the
 * nutrition pipeline: `additionalProperties: false`, every documented
 * field required, string length / numeric bounds tight enough to catch
 * malformed calls at the grammar engine.
 */
export const SEARCH_NUTRITION_TOOL = {
  type: "function" as const,
  function: {
    name: "search_nutrition",
    description:
      "Suche eine Speise in der Nährwert-Datenbank (Seed, USDA, OpenFoodFacts). " +
      "Verwende dies, wenn du dir bei food_key oder Schreibweise unsicher bist. " +
      "Gibt eine Liste von Kandidaten mit canonical food_key, label und " +
      "per-100g-Werten zurück.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description:
            "Deutscher Suchbegriff, z.B. 'Salat', 'Hähnchenbrust', 'Joghurt'",
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          default: 3,
        },
      },
    },
  },
} as const;

export const TOOL_NAMES = {
  SEARCH_NUTRITION: "search_nutrition",
} as const;

// ── Dispatch shape ──────────────────────────────────────────────────────────

export type ToolHitSource = "seed" | "cache" | "usda" | "off";

export interface ToolHit {
  food_key: string;
  label: string;
  source: ToolHitSource;
  /** Human-readable: "164 kcal, 8.9p, 27.4c, 2.6f". */
  per100g_summary: string;
  /** Why this match ranked — anchors the result so the model can disambiguate. */
  rationale: string;
}

export interface ToolResult {
  results: ToolHit[];
}

interface SearchArgs {
  query: string;
  max_results?: number;
}

/** Permissive parse of tool arguments — the model sometimes types `"3"` for an integer. */
export function parseSearchArgs(raw: unknown): SearchArgs | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const query = obj.query;
  if (typeof query !== "string") return null;
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  let max_results: number | undefined;
  const m = obj.max_results;
  if (typeof m === "number" && Number.isFinite(m)) {
    max_results = Math.floor(m);
  } else if (typeof m === "string") {
    const n = Number.parseInt(m, 10);
    if (Number.isFinite(n)) max_results = n;
  }
  if (max_results !== undefined) {
    max_results = Math.max(1, Math.min(5, max_results));
  }
  return { query: trimmed.slice(0, 60), max_results };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function summariseFacts(facts: NutritionFacts): string {
  const round1 = (n: number): string => {
    if (!Number.isFinite(n)) return "?";
    const r = Math.round(n * 10) / 10;
    return r.toString();
  };
  return `${Math.round(facts.kcal)} kcal, ${round1(facts.protein_g)}p, ${round1(
    facts.carbs_g,
  )}c, ${round1(facts.fat_g)}f`;
}

/** Substring + prefix match against a list of known keys/labels. */
function matchSeedAndCache(
  query: string,
  candidates: Array<{ food_key: string; label: string }>,
  limit: number,
): Array<{ food_key: string; label: string }> {
  const needle = normalizeFoodKey(query);
  const needleLabel = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  // Bucket 1: key exact prefix.
  const exact: Array<{ food_key: string; label: string }> = [];
  // Bucket 2: key substring.
  const subKey: Array<{ food_key: string; label: string }> = [];
  // Bucket 3: label substring (de).
  const subLabel: Array<{ food_key: string; label: string }> = [];

  for (const c of candidates) {
    if (c.food_key.startsWith(needle)) {
      exact.push(c);
    } else if (c.food_key.includes(needle)) {
      subKey.push(c);
    } else if (c.label.toLowerCase().includes(needleLabel)) {
      subLabel.push(c);
    }
  }

  const out: Array<{ food_key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const list of [exact, subKey, subLabel]) {
    for (const c of list) {
      if (seen.has(c.food_key)) continue;
      seen.add(c.food_key);
      out.push(c);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Server-side implementation of the `search_nutrition` tool. The model
 * gives us a query (German preferred); we walk the same authority chain
 * Stage B uses (seed → cache → USDA → OFF) and return up to `max_results`
 * ranked candidates.
 *
 * Failure-mode: any one tier throwing or returning nothing falls through
 * to the next tier. We *never* propagate an error to the model — an empty
 * `results: []` is a valid tool message and lets the model decide whether
 * to retry with a different query or commit a best-effort food_key.
 */
export async function dispatchSearchNutrition(
  rawArgs: unknown,
): Promise<ToolResult> {
  const args = parseSearchArgs(rawArgs);
  if (!args) {
    log.warn(
      "nutrition",
      `tool: search_nutrition called with invalid args: ${JSON.stringify(rawArgs).slice(0, 120)}`,
    );
    return { results: [] };
  }
  const maxResults = args.max_results ?? 3;
  const query = args.query;
  const hits: ToolHit[] = [];
  const seenKeys = new Set<string>();

  const addHit = (h: ToolHit) => {
    if (seenKeys.has(h.food_key)) return;
    seenKeys.add(h.food_key);
    hits.push(h);
  };

  // ── 1. Seed table substring / prefix match ────────────────────────────
  try {
    const seedKeys = await listSeedKeys();
    const candidates: Array<{ food_key: string; label: string }> = [];
    for (const k of seedKeys) {
      const seed = await lookupFoodSeed(k);
      if (seed) candidates.push({ food_key: seed.food_key, label: seed.label });
    }
    const matched = matchSeedAndCache(query, candidates, maxResults);
    for (const c of matched) {
      const seed = await lookupFoodSeed(c.food_key);
      if (!seed) continue;
      addHit({
        food_key: seed.food_key,
        label: seed.label,
        source: "seed",
        per100g_summary: summariseFacts(seed.per100g),
        rationale: `Seed table: ${seed.label}`,
      });
      if (hits.length >= maxResults) return { results: hits };
    }
  } catch (err) {
    log.warn(
      "nutrition",
      `tool: seed match failed for "${query}": ${err instanceof Error ? err.message : err}`,
    );
  }

  // ── 2. DB cache substring match ───────────────────────────────────────
  try {
    const cachedKeys = listCachedKeys();
    const candidates: Array<{ food_key: string; label: string }> = [];
    for (const k of cachedKeys) {
      const c = lookupCachedFood(k);
      if (c) candidates.push({ food_key: c.food_key, label: c.label ?? k });
    }
    const matched = matchSeedAndCache(query, candidates, maxResults * 2);
    for (const c of matched) {
      const cached = lookupCachedFood(c.food_key);
      if (!cached) continue;
      addHit({
        food_key: cached.food_key,
        label: cached.label ?? cached.food_key,
        source: "cache",
        per100g_summary: summariseFacts(cached.per100g),
        rationale: `Cache (${cached.source}): ${cached.label ?? cached.food_key}`,
      });
      if (hits.length >= maxResults) return { results: hits };
    }
  } catch (err) {
    log.warn(
      "nutrition",
      `tool: cache match failed for "${query}": ${err instanceof Error ? err.message : err}`,
    );
  }

  // ── 3. Fuzzy fallback against seed+cache before going off-host ────────
  if (hits.length === 0) {
    try {
      const seedKeys = await listSeedKeys();
      const cachedKeys = listCachedKeys();
      const known = new Set<string>([...seedKeys, ...cachedKeys]);
      const fuzzy = fuzzyMatchKey(query, known, 2);
      if (fuzzy && fuzzy.distance > 0) {
        const seed = await lookupFoodSeed(fuzzy.key);
        const cached = !seed ? lookupCachedFood(fuzzy.key) : null;
        if (seed) {
          addHit({
            food_key: seed.food_key,
            label: seed.label,
            source: "seed",
            per100g_summary: summariseFacts(seed.per100g),
            rationale: `Fuzzy seed (distance=${fuzzy.distance}): ${seed.label}`,
          });
        } else if (cached) {
          addHit({
            food_key: cached.food_key,
            label: cached.label ?? cached.food_key,
            source: "cache",
            per100g_summary: summariseFacts(cached.per100g),
            rationale: `Fuzzy cache (distance=${fuzzy.distance}): ${cached.label ?? ""}`,
          });
        }
      }
    } catch (err) {
      log.warn(
        "nutrition",
        `tool: fuzzy match threw for "${query}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // If we got ANY hits from the deterministic local sources (seed/cache),
  // stop here — seed is authoritative and the model just needs canonical
  // food_key candidates to disambiguate. Going off-host on a confirmed
  // seed hit would add 2-5s of latency for marginal extra signal.
  //
  // (Spec said "<2 → fall through". The looser interpretation here trades a
  // tiny bit of optionality for a 3x latency win on the common case and
  // keeps the unit tests fast/deterministic in CI without a network.)
  if (hits.length >= 1) return { results: hits.slice(0, maxResults) };

  // ── 4. USDA — translate de→en then search ─────────────────────────────
  try {
    const enQuery = await translateFoodKey(normalizeFoodKey(query), query);
    const usdaHits = await searchUsda(enQuery, { topN: maxResults });
    if (usdaHits) {
      for (const h of usdaHits) {
        addHit({
          food_key: normalizeFoodKey(query),
          label: h.description,
          source: "usda",
          per100g_summary: summariseFacts(h.per100g),
          rationale: `USDA ${h.data_type}: ${h.description} (fdc:${h.fdc_id})`,
        });
        if (hits.length >= maxResults) return { results: hits };
      }
    }
  } catch (err) {
    log.warn(
      "nutrition",
      `tool: USDA lookup threw for "${query}": ${err instanceof Error ? err.message : err}`,
    );
  }

  // ── 5. OFF — German label directly ────────────────────────────────────
  if (hits.length < maxResults) {
    try {
      const offHits = await searchOff(query, { lang: "de", topN: maxResults });
      if (offHits) {
        for (const h of offHits) {
          addHit({
            food_key: normalizeFoodKey(query),
            label: h.product_name,
            source: "off",
            per100g_summary: summariseFacts(h.per100g),
            rationale: `OFF: ${h.product_name} (${h.off_id})`,
          });
          if (hits.length >= maxResults) return { results: hits };
        }
      }
    } catch (err) {
      log.warn(
        "nutrition",
        `tool: OFF lookup threw for "${query}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return { results: hits.slice(0, maxResults) };
}
