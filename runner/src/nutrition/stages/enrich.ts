/**
 * Stage B — nutrition enrichment.
 *
 * Per classified component, resolve per-100g nutrition. Layered:
 *   1. Static seed table (`food-db/seed.json`) — instant, deterministic.
 *   2. PULSE_FOOD_NUTRITION cache (`food-db/db-cache.ts`) — persists across
 *      runs/restarts. The Pi is the single writer; the Mac runner reads
 *      pulse.db via Syncthing and POSTs writes via pushFood.
 *   3. In-process memory cache to absorb same-run repeats and act as the
 *      authoritative copy of any rows that haven't replicated back from the
 *      Pi yet (Syncthing has a propagation delay).
 *   4. LLM fallback via qwen3.6 text (`stages/enrich-llm.ts`). On success we
 *      persist to PULSE_FOOD_NUTRITION so the next encounter is a cache hit.
 *
 * Output: each MealComponent gets a NutritionSnapshot { per100g, totals }
 * with totals = per100g * grams / 100.
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
import { enrichFoodViaLLM } from "./enrich-llm.ts";
import type {
  ClassifyOutput,
  MealComponent,
  NutritionFacts,
} from "../types.ts";

interface CachedFood {
  per100g: NutritionFacts;
  label_de: string;
  model: string;
  captured_at: string;
}

/**
 * Same-run cache. Absorbs intra-process repeats (a meal with two slices of
 * the same bread) and bridges the Syncthing replication delay between the
 * Pi insert and the next Mac read. Persistent storage is PULSE_FOOD_NUTRITION.
 */
const llmCache = new Map<string, CachedFood>();

export interface EnrichResult {
  components: MealComponent[];
  totals: NutritionFacts;
  unresolved: string[];
  llmHits: string[];
}

export async function enrichComponents(classify: ClassifyOutput): Promise<EnrichResult> {
  const components: MealComponent[] = [];
  const unresolved: string[] = [];
  const llmHits: string[] = [];
  let ord = 0;

  const seedKeys = await listSeedKeys();
  // Build the set of known keys once: seed table + DB-persisted LLM cache +
  // anything we've LLM-resolved during this run.
  const known = new Set<string>([...seedKeys, ...listCachedKeys(), ...llmCache.keys()]);

  for (const c of classify.components) {
    const normalised = normalizeFoodKey(c.food_key);
    let resolvedKey = normalised;
    let per100g: NutritionFacts | null = null;

    const seed = await lookupFoodSeed(resolvedKey);
    if (seed) {
      per100g = seed.per100g;
    } else {
      const memHit = llmCache.get(resolvedKey);
      if (memHit) {
        per100g = memHit.per100g;
      } else {
        const dbHit = lookupCachedFood(resolvedKey);
        if (dbHit) per100g = dbHit.per100g;
      }
    }

    if (!per100g) {
      const fuzzy = fuzzyMatchKey(resolvedKey, known, 2);
      if (fuzzy && fuzzy.key !== resolvedKey) {
        log.info(
          "nutrition",
          `enrich: fuzzy match ${normalised} → ${fuzzy.key} (distance=${fuzzy.distance})`,
        );
        resolvedKey = fuzzy.key;
        const seedHit = await lookupFoodSeed(resolvedKey);
        per100g =
          seedHit?.per100g ??
          llmCache.get(resolvedKey)?.per100g ??
          lookupCachedFood(resolvedKey)?.per100g ??
          null;
      }
    }

    if (!per100g) {
      try {
        const llm = await enrichFoodViaLLM({ food_key: resolvedKey, label_de: c.label });
        llmCache.set(resolvedKey, {
          per100g: llm.per100g,
          label_de: llm.raw.label_de,
          model: llm.model,
          captured_at: llm.captured_at,
        });
        known.add(resolvedKey);
        llmHits.push(resolvedKey);
        per100g = llm.per100g;
        // Persist to PULSE_FOOD_NUTRITION via the Pi so the next encounter
        // of this food_key skips the LLM call entirely. Fire-and-forget:
        // a failed push doesn't invalidate the enrichment we already have
        // in the in-process cache for this run.
        pushFood({
          food_key: resolvedKey,
          label: llm.raw.label_de ?? null,
          source: "llm",
          model: llm.model,
          per100g: llm.per100g as unknown as Record<string, number>,
          captured_at: llm.captured_at,
        })
          .then((r) => {
            if (!r.ok && !r.queued) {
              log.warn(
                "nutrition",
                `enrich: pushFood for ${resolvedKey} failed: ${r.error ?? "unknown"}`,
              );
            }
          })
          .catch((err) => {
            log.warn(
              "nutrition",
              `enrich: pushFood for ${resolvedKey} threw: ${err instanceof Error ? err.message : err}`,
            );
          });
      } catch (err) {
        log.warn(
          "nutrition",
          `enrich: LLM fallback failed for ${resolvedKey}: ${err instanceof Error ? err.message : err}`,
        );
        unresolved.push(resolvedKey);
      }
    }

    if (!per100g) {
      const zero: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
      components.push({
        ord: ord++,
        food_key: resolvedKey,
        label: c.label,
        grams: c.grams,
        confidence: c.confidence,
        source: c.source,
        nutrition: { per100g: zero, totals: zero },
      });
      continue;
    }
    const totals = scaleNutrition(per100g, c.grams);
    components.push({
      ord: ord++,
      food_key: resolvedKey,
      label: c.label,
      grams: c.grams,
      confidence: c.confidence,
      source: c.source,
      nutrition: { per100g, totals },
    });
  }
  const totals = sumNutrition(components.map((c) => c.nutrition.totals));
  if (unresolved.length > 0) {
    log.warn("nutrition", `enrich: ${unresolved.length} unresolved food_keys: ${unresolved.join(",")}`);
  }
  if (llmHits.length > 0) {
    log.info("nutrition", `enrich: LLM hits ${llmHits.length}: ${llmHits.join(",")}`);
  }
  return { components, totals, unresolved, llmHits };
}
