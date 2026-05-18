/**
 * USDA FoodData Central client.
 *
 * Phase 2b grounding source for Stage B nutrition lookup. Free, no auth
 * required for the `DEMO_KEY` dev path; production sets USDA_FDC_API_KEY
 * (1000 requests/hour quota). Search returns the top hits, ranked client-
 * side: SR Legacy + Foundation (raw single-ingredient references) win over
 * Survey (FNDDS) (recipe-based composite estimates) — the latter is
 * sometimes the only hit for prepared dishes.
 *
 * Endpoint: `api.nal.usda.gov/fdc/v1/foods/search`.
 *
 * Returns null on any error (network, timeout, schema drift, sanity-bound
 * violation) so the caller can fall through to the next grounding source
 * without crashing the pipeline.
 */

import { log } from "../../logger.ts";
import type { NutritionFacts } from "../types.ts";

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1/foods/search";
const DEFAULT_TIMEOUT_MS = 5_000;

export type UsdaDataType = "Foundation" | "SR Legacy" | "Survey (FNDDS)" | "Branded";

const DATA_TYPE_RANK: Record<UsdaDataType, number> = {
  Foundation: 0,
  "SR Legacy": 1,
  "Survey (FNDDS)": 2,
  Branded: 3,
};

export interface UsdaHit {
  fdc_id: number;
  description: string;
  data_type: UsdaDataType;
  per100g: NutritionFacts;
}

interface RawNutrient {
  nutrientName?: string;
  unitName?: string;
  value?: number;
}

interface RawFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients: RawNutrient[];
}

interface RawSearchResponse {
  foods?: RawFood[];
}

let _keyWarned = false;

function apiKey(): string {
  const k = process.env.USDA_FDC_API_KEY?.trim();
  if (k) return k;
  if (!_keyWarned) {
    log.warn(
      "nutrition",
      "USDA_FDC_API_KEY unset — falling back to DEMO_KEY (low rate limit). " +
        "Get a free key at https://fdc.nal.usda.gov/api-key-signup.html.",
    );
    _keyWarned = true;
  }
  return "DEMO_KEY";
}

/**
 * Map a USDA nutrient name onto our NutritionFacts field. Returns null for
 * names we don't currently track — the dashboard's chart panels only render
 * the fields in NutritionFacts so unmapped values are silently dropped.
 */
function mapNutrient(name: string): keyof NutritionFacts | null {
  switch (name) {
    case "Energy":
      return "kcal";
    case "Protein":
      return "protein_g";
    case "Carbohydrate, by difference":
      return "carbs_g";
    case "Total lipid (fat)":
      return "fat_g";
    case "Fiber, total dietary":
      return "fiber_g";
    case "Sugars, total including NLEA":
      return "sugar_g";
    case "Fatty acids, total saturated":
      return "saturated_fat_g";
    case "Sodium, Na":
      return "sodium_mg";
    case "Iron, Fe":
      return "iron_mg";
    case "Calcium, Ca":
      return "calcium_mg";
    case "Magnesium, Mg":
      return "magnesium_mg";
    case "Zinc, Zn":
      return "zinc_mg";
    case "Vitamin C, total ascorbic acid":
      return "vit_c_mg";
    case "Vitamin D (D2 + D3)":
      return "vit_d_ug";
    case "Vitamin B-12":
      return "vit_b12_ug";
    case "Folate, total":
      return "folate_ug";
    default:
      return null;
  }
}

/** Bounds match runner/src/schemas/nutrition/enrich-output.schema.json. */
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

function withinBounds(facts: NutritionFacts): boolean {
  for (const [k, [lo, hi]] of Object.entries(BOUNDS) as Array<
    [keyof NutritionFacts, [number, number]]
  >) {
    const v = facts[k];
    if (typeof v === "number" && (v < lo || v > hi)) return false;
  }
  return true;
}

function parseHit(food: RawFood, allowBranded: boolean): UsdaHit | null {
  if (!food || !Array.isArray(food.foodNutrients)) return null;
  const dataType = food.dataType as UsdaDataType;
  if (!(dataType in DATA_TYPE_RANK)) return null;
  // Branded entries are 12k brand-specific Nutrition-Facts-label rows: low
  // signal for our use case (an "Onion" component shouldn't snap to a
  // single supermarket SKU). Only accept Branded when the caller opted in.
  if (dataType === "Branded" && !allowBranded) return null;
  const facts: Record<string, number> = {};
  for (const n of food.foodNutrients) {
    if (typeof n.nutrientName !== "string" || typeof n.value !== "number") continue;
    const key = mapNutrient(n.nutrientName);
    if (!key) continue;
    // Energy returns in both KCAL and KJ — pick the first KCAL value we see.
    if (key === "kcal" && n.unitName && n.unitName.toUpperCase() !== "KCAL") continue;
    if (!(key in facts)) facts[key] = n.value;
  }
  // Macros are mandatory; if USDA returned no kcal/protein/carbs/fat there's
  // no value in keeping the row around.
  if (
    typeof facts.kcal !== "number" ||
    typeof facts.protein_g !== "number" ||
    typeof facts.carbs_g !== "number" ||
    typeof facts.fat_g !== "number"
  ) {
    return null;
  }
  const per100g = facts as unknown as NutritionFacts;
  if (!withinBounds(per100g)) return null;
  return {
    fdc_id: food.fdcId,
    description: food.description,
    data_type: dataType,
    per100g,
  };
}

export interface UsdaSearchOpts {
  /** Filter list; default Foundation + SR Legacy + Survey (FNDDS). */
  dataTypes?: UsdaDataType[];
  /** Cap on returned hits after ranking. Default 5. */
  topN?: number;
  signal?: AbortSignal;
}

const DEFAULT_DATA_TYPES: UsdaDataType[] = [
  "Foundation",
  "SR Legacy",
  "Survey (FNDDS)",
];

/**
 * Search USDA FDC for the top ranked hits matching `query`. Returns null on
 * any failure path — caller falls through to OFF / LLM enrich.
 */
export async function searchUsda(
  query: string,
  opts: UsdaSearchOpts = {},
): Promise<UsdaHit[] | null> {
  const q = query.trim();
  if (!q) return null;
  const dataTypes = opts.dataTypes ?? DEFAULT_DATA_TYPES;
  const topN = opts.topN ?? 5;

  const key = apiKey();
  const params = new URLSearchParams({
    api_key: key,
    query: q,
    pageSize: String(Math.max(topN, 5)),
  });
  // DEMO_KEY is observed to reject requests that include a `dataType` filter
  // (HTTP 400 from nginx). Real keys honour it. We always rank client-side
  // anyway, so dropping the filter for DEMO_KEY is safe: parseHit() still
  // discards Branded entries via DATA_TYPE_RANK and the sort pulls
  // Foundation / SR Legacy to the front.
  if (key !== "DEMO_KEY") {
    params.set("dataType", dataTypes.join(","));
  }
  const url = `${USDA_BASE}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  // Honour caller's abort signal too — chain both.
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn("nutrition", `searchUsda ${q}: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as RawSearchResponse;
    const foods = Array.isArray(json.foods) ? json.foods : [];
    const allowBranded = dataTypes.includes("Branded");
    const hits: UsdaHit[] = [];
    for (const f of foods) {
      const hit = parseHit(f, allowBranded);
      if (hit) hits.push(hit);
    }
    if (hits.length === 0) return null;
    hits.sort((a, b) => DATA_TYPE_RANK[a.data_type] - DATA_TYPE_RANK[b.data_type]);
    return hits.slice(0, topN);
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      log.warn("nutrition", `searchUsda ${q}: aborted`);
    } else {
      log.warn(
        "nutrition",
        `searchUsda ${q}: ${err instanceof Error ? err.message : err}`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
