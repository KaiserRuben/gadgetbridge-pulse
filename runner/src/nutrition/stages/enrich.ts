/**
 * Stage B — nutrition enrichment with Phase 2b grounding cascade.
 *
 * Per classified component, resolve per-100g nutrition through:
 *
 *   1. Static seed table (`food-db/seed.json`) — instant, deterministic.
 *   2. In-process mem cache — absorbs same-run repeats.
 *   3. PULSE_FOOD_NUTRITION cache (`food-db/db-cache.ts`) — persists across
 *      runs; the Pi is the single writer, the Mac runner reads pulse.db via
 *      Syncthing and POSTs writes via pushFood.
 *   4. Fuzzy match against known keys (seed ∪ cache ∪ mem) — Damerau-
 *      Levenshtein, distance ≤ 2.
 *   5. **NEW** USDA FoodData Central — single-ingredient authority (SR
 *      Legacy / Foundation preferred). Translates de→en first via
 *      `translateFoodKey`.
 *   6. **NEW** Open Food Facts — community DB, German-country preference
 *      for German food keys.
 *   7. LLM enrich via qwen3.6 (`stages/enrich-llm.ts`) — last resort.
 *
 * Every step that hits writes the result to PULSE_FOOD_NUTRITION via the
 * Pi's pushFood ingest path so the next encounter of the same food_key
 * skips straight to step 3.
 *
 * Each component carries a `provenance: ProvenanceTag[]` derived from the
 * step that resolved it, plus a tag for the VLM/user_text identity claim.
 */

import { log } from "../../logger.ts";
import { pushFood } from "../../ingest/client.ts";
import {
  listSeedKeys,
  lookupFoodSeed,
  scaleNutrition,
  sumNutrition,
} from "../food-db/lookup.ts";
import { listCachedKeys, lookupCachedFood } from "../food-db/db-cache.ts";
import { fuzzyMatchKey, normalizeFoodKey } from "../food-db/normalize.ts";
import { searchUsda } from "../food-db/usda.ts";
import { searchOff } from "../food-db/off.ts";
import { translateFoodKey } from "../food-db/translate.ts";
import { enrichFoodViaLLM } from "./enrich-llm.ts";
import type { ProvenanceTag, ProvenanceSource } from "../../jobs/types.ts";
import type {
  ClassifyOutput,
  FoodNutritionSource,
  MealComponent,
  NutritionFacts,
} from "../types.ts";

interface CachedFood {
  per100g: NutritionFacts;
  label_de: string;
  model: string;
  captured_at: string;
  source: FoodNutritionSource;
}

const llmCache = new Map<string, CachedFood>();

export interface EnrichResult {
  components: MealComponent[];
  totals: NutritionFacts;
  unresolved: string[];
  /** Food keys that the LLM-fallback path resolved this run. */
  llmHits: string[];
  /** Food keys resolved via USDA grounding this run. */
  usdaHits: string[];
  /** Food keys resolved via OFF grounding this run. */
  offHits: string[];
}

interface Resolution {
  per100g: NutritionFacts;
  source: FoodNutritionSource;
  externalId?: string;
  /** USDA/OFF description for diagnostics — kept off the wire payload. */
  description?: string;
}

function provenanceSourceFor(s: FoodNutritionSource): ProvenanceSource {
  switch (s) {
    case "seed":
      return "seed_data";
    case "llm":
      return "llm_derived";
    case "usda":
    case "off":
      return "external_db";
    case "user":
      return "user_edited";
  }
}

function makeComponentProvenance(
  identitySource: "vlm" | "user_text" | "user_edit" | "user_add",
  resolution: Resolution,
  confidence: number | null,
): ProvenanceTag[] {
  const tags: ProvenanceTag[] = [];

  // Identity claim — who said this is "Fladenbrot"?
  const identityTag: ProvenanceTag = {
    field_path: "identity",
    source: (
      identitySource === "user_text" || identitySource === "user_edit"
        ? "user_input"
        : identitySource === "user_add"
          ? "user_input"
          : "vlm_inferred"
    ) as ProvenanceSource,
  };
  if (typeof confidence === "number") identityTag.confidence = confidence;
  tags.push(identityTag);

  // Nutrition per-100g — where did the numbers come from?
  // `external_id` is namespaced (`usda:<id>` / `off:<id>`) so the dashboard can
  // distinguish USDA vs OFF after the source enum squashes both to external_db.
  const nutritionTag: ProvenanceTag = {
    field_path: "nutrition.per100g",
    source: provenanceSourceFor(resolution.source),
  };
  if (resolution.externalId) {
    const ns = resolution.source === "usda" || resolution.source === "off"
      ? `${resolution.source}:`
      : "";
    nutritionTag.external_id = `${ns}${resolution.externalId}`;
  }
  tags.push(nutritionTag);

  return tags;
}

async function tryUsda(
  food_key: string,
  label_de: string,
): Promise<Resolution | null> {
  const query = await translateFoodKey(food_key, label_de);
  const hits = await searchUsda(query, { topN: 1 });
  if (!hits || hits.length === 0) return null;
  const top = hits[0];
  return {
    per100g: top.per100g,
    source: "usda",
    externalId: String(top.fdc_id),
    description: top.description,
  };
}

async function tryOff(label_de: string): Promise<Resolution | null> {
  // OFF returns better results for the German label (most German food
  // products in the DB carry German product_names) — skip the translation.
  const hits = await searchOff(label_de, { lang: "de", topN: 1 });
  if (!hits || hits.length === 0) return null;
  const top = hits[0];
  return {
    per100g: top.per100g,
    source: "off",
    externalId: top.off_id,
    description: top.product_name,
  };
}

/**
 * Fire-and-forget persist to PULSE_FOOD_NUTRITION. The Pi is the single
 * writer; a failure here doesn't invalidate the in-process resolution.
 */
function persistFood(
  food_key: string,
  resolution: Resolution,
  label_de: string,
  model: string | null,
  captured_at: string,
  en_query: string | null,
): void {
  pushFood({
    food_key,
    label: label_de,
    source: resolution.source,
    model,
    per100g: resolution.per100g as unknown as Record<string, number>,
    captured_at,
    en_query,
  })
    .then((r) => {
      if (!r.ok && !r.queued) {
        log.warn(
          "nutrition",
          `enrich: pushFood for ${food_key} failed: ${r.error ?? "unknown"}`,
        );
      }
    })
    .catch((err) => {
      log.warn(
        "nutrition",
        `enrich: pushFood for ${food_key} threw: ${err instanceof Error ? err.message : err}`,
      );
    });
}

export async function enrichComponents(classify: ClassifyOutput): Promise<EnrichResult> {
  const components: MealComponent[] = [];
  const unresolved: string[] = [];
  const llmHits: string[] = [];
  const usdaHits: string[] = [];
  const offHits: string[] = [];
  let ord = 0;

  const seedKeys = await listSeedKeys();
  const known = new Set<string>([...seedKeys, ...listCachedKeys(), ...llmCache.keys()]);

  for (const c of classify.components) {
    const normalised = normalizeFoodKey(c.food_key);
    let resolvedKey = normalised;
    let resolution: Resolution | null = null;

    // 1. Seed.
    const seed = await lookupFoodSeed(resolvedKey);
    if (seed) {
      resolution = { per100g: seed.per100g, source: "seed" };
    }

    // 2. + 3. Same-run mem cache + DB cache.
    if (!resolution) {
      const memHit = llmCache.get(resolvedKey);
      if (memHit) {
        resolution = { per100g: memHit.per100g, source: memHit.source };
      } else {
        const dbHit = lookupCachedFood(resolvedKey);
        if (dbHit) {
          resolution = { per100g: dbHit.per100g, source: dbHit.source };
        }
      }
    }

    // 4. Fuzzy match.
    if (!resolution) {
      const fuzzy = fuzzyMatchKey(resolvedKey, known, 2);
      if (fuzzy && fuzzy.key !== resolvedKey) {
        log.info(
          "nutrition",
          `enrich: fuzzy match ${normalised} → ${fuzzy.key} (distance=${fuzzy.distance})`,
        );
        resolvedKey = fuzzy.key;
        const fuzzySeed = await lookupFoodSeed(resolvedKey);
        const fuzzyMem = llmCache.get(resolvedKey);
        const fuzzyDb = lookupCachedFood(resolvedKey);
        if (fuzzySeed) {
          resolution = { per100g: fuzzySeed.per100g, source: "seed" };
        } else if (fuzzyMem) {
          resolution = { per100g: fuzzyMem.per100g, source: fuzzyMem.source };
        } else if (fuzzyDb) {
          resolution = { per100g: fuzzyDb.per100g, source: fuzzyDb.source };
        }
      }
    }

    // 5. USDA grounding.
    if (!resolution) {
      try {
        const hit = await tryUsda(resolvedKey, c.label);
        if (hit) {
          resolution = hit;
          usdaHits.push(resolvedKey);
          const en = await translateFoodKey(resolvedKey, c.label);
          const captured_at = new Date().toISOString();
          llmCache.set(resolvedKey, {
            per100g: hit.per100g,
            label_de: c.label,
            model: "usda",
            captured_at,
            source: "usda",
          });
          known.add(resolvedKey);
          persistFood(resolvedKey, hit, c.label, "usda", captured_at, en);
          log.info(
            "nutrition",
            `enrich: usda ${resolvedKey} → fdc:${hit.externalId} (${hit.description ?? ""})`,
          );
        }
      } catch (err) {
        log.warn(
          "nutrition",
          `enrich: usda lookup threw for ${resolvedKey}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // 6. Open Food Facts grounding.
    if (!resolution) {
      try {
        const hit = await tryOff(c.label);
        if (hit) {
          resolution = hit;
          offHits.push(resolvedKey);
          const captured_at = new Date().toISOString();
          llmCache.set(resolvedKey, {
            per100g: hit.per100g,
            label_de: c.label,
            model: "off",
            captured_at,
            source: "off",
          });
          known.add(resolvedKey);
          persistFood(resolvedKey, hit, c.label, "off", captured_at, null);
          log.info(
            "nutrition",
            `enrich: off ${resolvedKey} → ${hit.externalId} (${hit.description ?? ""})`,
          );
        }
      } catch (err) {
        log.warn(
          "nutrition",
          `enrich: off lookup threw for ${resolvedKey}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // 7. LLM fallback.
    if (!resolution) {
      try {
        const llm = await enrichFoodViaLLM({
          food_key: resolvedKey,
          label_de: c.label,
        });
        resolution = { per100g: llm.per100g, source: "llm" };
        llmCache.set(resolvedKey, {
          per100g: llm.per100g,
          label_de: llm.raw.label_de,
          model: llm.model,
          captured_at: llm.captured_at,
          source: "llm",
        });
        known.add(resolvedKey);
        llmHits.push(resolvedKey);
        persistFood(
          resolvedKey,
          resolution,
          llm.raw.label_de ?? c.label,
          llm.model,
          llm.captured_at,
          null,
        );
      } catch (err) {
        log.warn(
          "nutrition",
          `enrich: LLM fallback failed for ${resolvedKey}: ${err instanceof Error ? err.message : err}`,
        );
        unresolved.push(resolvedKey);
      }
    }

    if (!resolution) {
      const zero: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
      const zeroResolution: Resolution = { per100g: zero, source: "llm" };
      components.push({
        ord: ord++,
        food_key: resolvedKey,
        label: c.label,
        grams: c.grams,
        confidence: c.confidence,
        source: c.source,
        nutrition: { per100g: zero, totals: zero },
        provenance: makeComponentProvenance(c.source, zeroResolution, c.confidence),
      });
      continue;
    }

    const totals = scaleNutrition(resolution.per100g, c.grams);
    components.push({
      ord: ord++,
      food_key: resolvedKey,
      label: c.label,
      grams: c.grams,
      confidence: c.confidence,
      source: c.source,
      nutrition: { per100g: resolution.per100g, totals },
      provenance: makeComponentProvenance(c.source, resolution, c.confidence),
    });
  }

  const totals = sumNutrition(components.map((c) => c.nutrition.totals));
  if (unresolved.length > 0) {
    log.warn(
      "nutrition",
      `enrich: ${unresolved.length} unresolved food_keys: ${unresolved.join(",")}`,
    );
  }
  if (usdaHits.length > 0) {
    log.info("nutrition", `enrich: usda hits ${usdaHits.length}: ${usdaHits.join(",")}`);
  }
  if (offHits.length > 0) {
    log.info("nutrition", `enrich: off hits ${offHits.length}: ${offHits.join(",")}`);
  }
  if (llmHits.length > 0) {
    log.info("nutrition", `enrich: LLM hits ${llmHits.length}: ${llmHits.join(",")}`);
  }
  return { components, totals, unresolved, llmHits, usdaHits, offHits };
}
