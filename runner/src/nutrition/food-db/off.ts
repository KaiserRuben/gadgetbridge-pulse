/**
 * Open Food Facts client.
 *
 * Phase 2b secondary grounding source, used when USDA doesn't have a hit
 * (which is common for German packaged-food specifics — "Vollkornbrot",
 * "Quark", "Brezel"). OFF is community-curated, no auth required, but
 * requires a polite User-Agent.
 *
 * Endpoint: `world.openfoodfacts.org/cgi/search.pl`.
 *
 * Returns null on any error path so the caller falls through to LLM enrich.
 */

import { log } from "../../logger.ts";
import type { NutritionFacts } from "../types.ts";

const OFF_BASE = "https://world.openfoodfacts.org/cgi/search.pl";
const DEFAULT_TIMEOUT_MS = 5_000;
const USER_AGENT = "pulse-runner/0.1 (kaiser@self-host)";

export interface OffHit {
  off_id: string;
  product_name: string;
  per100g: NutritionFacts;
  countries?: string[];
}

interface RawNutriments {
  [k: string]: number | string | undefined;
}

interface RawProduct {
  code?: string;
  product_name?: string;
  nutriments?: RawNutriments;
  countries_tags?: string[];
}

interface RawSearchResponse {
  products?: RawProduct[];
}

const BOUNDS: Partial<Record<keyof NutritionFacts, [number, number]>> = {
  kcal: [0, 900],
  protein_g: [0, 100],
  carbs_g: [0, 100],
  fat_g: [0, 100],
  fiber_g: [0, 50],
  iron_mg: [0, 50],
  vit_c_mg: [0, 1000],
  vit_b12_ug: [0, 200],
  calcium_mg: [0, 2000],
  magnesium_mg: [0, 1000],
};

function num(raw: number | string | undefined): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseHit(product: RawProduct): OffHit | null {
  if (!product || !product.code || !product.nutriments) return null;
  const n = product.nutriments;
  const kcal = num(n["energy-kcal_100g"]);
  const protein = num(n.proteins_100g);
  const carbs = num(n.carbohydrates_100g);
  const fat = num(n.fat_100g);
  // Drop hits without all four macros — OFF rows with only an `energy_100g`
  // (kJ) value but no per-macro breakdown are useless for our pipeline.
  if (
    typeof kcal !== "number" ||
    typeof protein !== "number" ||
    typeof carbs !== "number" ||
    typeof fat !== "number"
  ) {
    return null;
  }
  const facts: NutritionFacts = {
    kcal,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
  };

  const fiber = num(n.fiber_100g);
  if (typeof fiber === "number") facts.fiber_g = fiber;

  const sugars = num(n.sugars_100g);
  if (typeof sugars === "number") facts.sugar_g = sugars;

  const satfat = num(n["saturated-fat_100g"]);
  if (typeof satfat === "number") facts.saturated_fat_g = satfat;

  // OFF reports iron in grams. Convert to mg (× 1000) so we share units
  // with USDA. Same applies to calcium / magnesium / zinc which OFF lists
  // in grams on the 100g shape.
  const ironG = num(n.iron_100g);
  if (typeof ironG === "number") facts.iron_mg = ironG * 1000;

  const calciumG = num(n.calcium_100g);
  if (typeof calciumG === "number") facts.calcium_mg = calciumG * 1000;

  const magnesiumG = num(n.magnesium_100g);
  if (typeof magnesiumG === "number") facts.magnesium_mg = magnesiumG * 1000;

  const zincG = num(n.zinc_100g);
  if (typeof zincG === "number") facts.zinc_mg = zincG * 1000;

  // Vitamins.
  const vitCG = num(n["vitamin-c_100g"]);
  if (typeof vitCG === "number") facts.vit_c_mg = vitCG * 1000;

  const vitDG = num(n["vitamin-d_100g"]);
  if (typeof vitDG === "number") facts.vit_d_ug = vitDG * 1_000_000;

  const vitB12G = num(n["vitamin-b12_100g"]);
  if (typeof vitB12G === "number") facts.vit_b12_ug = vitB12G * 1_000_000;

  // Salt is given as g/100g; sodium = salt * 0.4 by the common conversion.
  const salt = num(n.salt_100g);
  if (typeof salt === "number") facts.sodium_mg = salt * 400;

  // Sanity-check against the locked bounds; reject the hit if anything is
  // way out (e.g. user-entered nutriments with comma/period mix-ups).
  for (const [k, [lo, hi]] of Object.entries(BOUNDS) as Array<
    [keyof NutritionFacts, [number, number]]
  >) {
    const v = facts[k];
    if (typeof v === "number" && (v < lo || v > hi)) return null;
  }

  return {
    off_id: product.code,
    product_name: product.product_name ?? product.code,
    per100g: facts,
    countries: Array.isArray(product.countries_tags) ? product.countries_tags : undefined,
  };
}

export interface OffSearchOpts {
  lang?: "de" | "en";
  topN?: number;
  signal?: AbortSignal;
}

/**
 * Search Open Food Facts for hits matching `query`. Hits with a German
 * country tag get bumped to the front when `lang==='de'` (default). Returns
 * null on any failure path.
 */
export async function searchOff(
  query: string,
  opts: OffSearchOpts = {},
): Promise<OffHit[] | null> {
  const q = query.trim();
  if (!q) return null;
  const topN = opts.topN ?? 5;
  const lang = opts.lang ?? "de";

  const params = new URLSearchParams({
    search_terms: q,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(Math.max(topN, 5)),
    fields: "code,product_name,nutriments,countries_tags,lang",
  });
  const url = `${OFF_BASE}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn("nutrition", `searchOff ${q}: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as RawSearchResponse;
    const products = Array.isArray(json.products) ? json.products : [];
    const hits: OffHit[] = [];
    for (const p of products) {
      const hit = parseHit(p);
      if (hit) hits.push(hit);
    }
    if (hits.length === 0) return null;
    if (lang === "de") {
      hits.sort((a, b) => {
        const aDe = a.countries?.includes("en:germany") ? 0 : 1;
        const bDe = b.countries?.includes("en:germany") ? 0 : 1;
        return aDe - bDe;
      });
    }
    return hits.slice(0, topN);
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      log.warn("nutrition", `searchOff ${q}: aborted`);
    } else {
      log.warn(
        "nutrition",
        `searchOff ${q}: ${err instanceof Error ? err.message : err}`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
