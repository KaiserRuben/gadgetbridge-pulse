/**
 * Food nutrition lookup. Two layers:
 *
 *  1. Static seed table at `food-db/seed.json` (~20 foods at v1, USDA-derived).
 *     Lookup is in-memory.
 *  2. LLM-derived cache in `PULSE_FOOD_NUTRITION` (source='llm'). Stable until
 *     the user manually clears it from the targets UI debug panel — never
 *     auto-invalidated, since per-100g values for the same food key don't
 *     drift over time. The dashboard owns the row; the Mac runner POSTs new
 *     entries via the ingest path (TODO: extend ingest client when enrichment
 *     LLM lands).
 *
 * The runner asks `lookup(food_key)` and gets back a NutritionFacts per-100g.
 * Miss → caller invokes the enrich LLM, persists the result.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { NutritionFacts } from "../types.ts";

const SEED_PATH = fileURLToPath(new URL("./seed.json", import.meta.url));

interface SeedShape {
  schema_version: string;
  foods: Record<string, { label: string; per100g: NutritionFacts }>;
}

let seedCache: SeedShape | null = null;

async function loadSeed(): Promise<SeedShape> {
  if (seedCache) return seedCache;
  const txt = await readFile(SEED_PATH, "utf8");
  seedCache = JSON.parse(txt) as SeedShape;
  return seedCache;
}

export interface FoodLookupHit {
  food_key: string;
  label: string;
  per100g: NutritionFacts;
  source: "seed" | "llm";
}

export async function lookupFoodSeed(foodKey: string): Promise<FoodLookupHit | null> {
  const seed = await loadSeed();
  const hit = seed.foods[foodKey];
  if (!hit) return null;
  return {
    food_key: foodKey,
    label: hit.label,
    per100g: hit.per100g,
    source: "seed",
  };
}

export async function listSeedKeys(): Promise<string[]> {
  const seed = await loadSeed();
  return Object.keys(seed.foods);
}

/** Multiply per-100g facts by `grams / 100`. */
export function scaleNutrition(per100g: NutritionFacts, grams: number): NutritionFacts {
  const factor = grams / 100;
  const out: NutritionFacts = {
    kcal: round(per100g.kcal * factor),
    protein_g: round(per100g.protein_g * factor),
    carbs_g: round(per100g.carbs_g * factor),
    fat_g: round(per100g.fat_g * factor),
  };
  const optional: (keyof NutritionFacts)[] = [
    "fiber_g",
    "sugar_g",
    "saturated_fat_g",
    "sodium_mg",
    "iron_mg",
    "calcium_mg",
    "magnesium_mg",
    "zinc_mg",
    "vit_c_mg",
    "vit_d_ug",
    "vit_b12_ug",
    "folate_ug",
    "omega3_g",
  ];
  for (const k of optional) {
    const v = per100g[k];
    if (typeof v === "number") out[k] = round(v * factor);
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function sumNutrition(items: NutritionFacts[]): NutritionFacts {
  const totals: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const it of items) {
    totals.kcal += it.kcal;
    totals.protein_g += it.protein_g;
    totals.carbs_g += it.carbs_g;
    totals.fat_g += it.fat_g;
    addOptional(totals, it, "fiber_g");
    addOptional(totals, it, "sugar_g");
    addOptional(totals, it, "saturated_fat_g");
    addOptional(totals, it, "sodium_mg");
    addOptional(totals, it, "iron_mg");
    addOptional(totals, it, "calcium_mg");
    addOptional(totals, it, "magnesium_mg");
    addOptional(totals, it, "zinc_mg");
    addOptional(totals, it, "vit_c_mg");
    addOptional(totals, it, "vit_d_ug");
    addOptional(totals, it, "vit_b12_ug");
    addOptional(totals, it, "folate_ug");
    addOptional(totals, it, "omega3_g");
  }
  return {
    ...totals,
    kcal: round(totals.kcal),
    protein_g: round(totals.protein_g),
    carbs_g: round(totals.carbs_g),
    fat_g: round(totals.fat_g),
  };
}

function addOptional(
  out: NutritionFacts,
  src: NutritionFacts,
  key: keyof NutritionFacts,
): void {
  const v = src[key];
  if (typeof v === "number") {
    out[key] = (out[key] ?? 0) + v;
  }
}
