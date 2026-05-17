/**
 * Shared nutrition helpers used by both the DB-backed reader (`data.ts`)
 * and the design-time fixtures (`fixtures.ts`).
 */

import type {
  DayPatternEvent,
  Meal,
  NutrientTarget,
  NutritionFacts,
  NutritionTargets,
} from "./types";

export const NUTRITION_TZ = "Europe/Berlin";

export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: NUTRITION_TZ,
  });
}

export function fmtDayLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: NUTRITION_TZ,
  });
}

export function fmtDayHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: NUTRITION_TZ,
  });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: NUTRITION_TZ,
  });
}

const ZERO_FACTS: NutritionFacts = {
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
};

const NUTRITION_KEYS: Array<keyof NutritionFacts> = [
  "kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
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

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function sum(facts: NutritionFacts[]): NutritionFacts {
  const out: NutritionFacts = { ...ZERO_FACTS };
  for (const k of NUTRITION_KEYS) {
    let total = 0;
    let any = false;
    for (const f of facts) {
      const v = f[k];
      if (typeof v === "number") {
        total += v;
        any = true;
      }
    }
    if (any) (out as unknown as Record<string, number>)[k] = round(total);
  }
  return out;
}

export function effectiveTarget(t: NutrientTarget): number | null {
  return t.target ?? t.default_target;
}

/**
 * URL for the photo served by `/api/nutrition/photo/[id]`. Returns null
 * for meals without a stored photo (text-only). Callers pipe this straight
 * into `<img src>`.
 */
export function mealPhotoUrl(meal: { id: string; photo_path: string | null }): string | null {
  if (!meal.photo_path) return null;
  return `/api/nutrition/photo/${meal.id}`;
}

/**
 * URL for a specific photo (by ord) attached to a meal. ord=0 is the cover.
 * Use this when rendering galleries; for thumbnails / list views stick with
 * `mealPhotoUrl()`.
 */
export function mealPhotoUrlAt(mealId: string, ord: number): string {
  return ord === 0
    ? `/api/nutrition/photo/${mealId}`
    : `/api/nutrition/photo/${mealId}?i=${ord}`;
}

/**
 * Deterministic event grouping over a chronological meal list. Same rules
 * as the fixtures fallback: snack-chain within 4h → snacking; gap <90min
 * with mixed kinds → multi_course; all-drinks → drink_round; singletons
 * → single_meal (or snacking for a lone snack).
 *
 * Replace with the v3 nutrition-cluster output once Stage 11 ships.
 */
export function eventsFromMeals(meals: Meal[]): DayPatternEvent[] {
  if (meals.length === 0) return [];
  const sorted = [...meals].sort(
    (a, b) => Date.parse(a.user_meal_at) - Date.parse(b.user_meal_at),
  );
  const ev: DayPatternEvent[] = [];
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor;
    while (end + 1 < sorted.length) {
      const cur = sorted[end];
      const next = sorted[end + 1];
      const gapMs =
        Date.parse(next.user_meal_at) - Date.parse(cur.user_meal_at);
      const snackChain = cur.kind === "snack" && next.kind === "snack";
      const limit = snackChain ? 4 * 60 * 60 * 1000 : 90 * 60 * 1000;
      if (gapMs >= limit) break;
      end += 1;
    }
    const group = sorted.slice(cursor, end + 1);
    const allDrinks = group.every((m) => m.kind === "drink");
    const allSnacks = group.every((m) => m.kind === "snack");
    const kind: DayPatternEvent["kind"] = allDrinks
      ? "drink_round"
      : allSnacks && group.length > 1
        ? "snacking"
        : group.length > 1
          ? "multi_course"
          : group[0].kind === "snack"
            ? "snacking"
            : "single_meal";
    const spanMin = Math.round(
      (Date.parse(group[group.length - 1].user_meal_at) -
        Date.parse(group[0].user_meal_at)) /
        60_000,
    );
    const summary =
      kind === "multi_course"
        ? `${group.length} Gänge in ${spanMin} min — als ein Anlass gewertet.`
        : kind === "drink_round"
          ? `${group.length} Getränke in ${spanMin} min — als Runde gewertet.`
          : kind === "snacking"
            ? group.length > 1
              ? `${group.length} Snacks über ${spanMin} min — als Grazing-Fenster gewertet.`
              : "Einzelner Snack zwischen den Mahlzeiten."
            : "Einzelne Mahlzeit.";
    ev.push({
      kind,
      started_at: group[0].user_meal_at,
      ended_at: group[group.length - 1].user_meal_at,
      meal_ids: group.map((m) => m.id),
      summary,
    });
    cursor = end + 1;
  }
  return ev;
}

export const DEFAULT_TARGETS: NutritionTargets = {
  updated_at: "2026-05-16T00:00:00+02:00",
  rows: [
    { key: "kcal", label: "Kalorien", unit: "kcal", group: "macro", target: null, default_target: 2400, auto_from: "active_kcal + bmr * 1.2" },
    { key: "protein_g", label: "Eiweiß", unit: "g", group: "macro", target: 130, default_target: 130, auto_from: "1.6 * weight_kg" },
    { key: "carbs_g", label: "Kohlenhydrate", unit: "g", group: "macro", target: null, default_target: 300, auto_from: null },
    { key: "fat_g", label: "Fett", unit: "g", group: "macro", target: 80, default_target: 80, auto_from: "min 20% kcal" },
    { key: "fiber_g", label: "Ballaststoffe", unit: "g", group: "macro", target: 30, default_target: 30, auto_from: null },
    { key: "iron_mg", label: "Eisen", unit: "mg", group: "micro", target: 10, default_target: 10, auto_from: "RDA m" },
    { key: "calcium_mg", label: "Calcium", unit: "mg", group: "micro", target: 1000, default_target: 1000, auto_from: "RDA" },
    { key: "magnesium_mg", label: "Magnesium", unit: "mg", group: "micro", target: 400, default_target: 400, auto_from: "RDA m" },
    { key: "zinc_mg", label: "Zink", unit: "mg", group: "micro", target: 11, default_target: 11, auto_from: "RDA m" },
    { key: "vit_c_mg", label: "Vitamin C", unit: "mg", group: "micro", target: 90, default_target: 90, auto_from: "RDA m" },
    { key: "vit_d_ug", label: "Vitamin D", unit: "ug", group: "micro", target: 15, default_target: 15, auto_from: "RDA" },
    { key: "vit_b12_ug", label: "Vitamin B12", unit: "ug", group: "micro", target: 4, default_target: 4, auto_from: "RDA" },
    { key: "folate_ug", label: "Folat", unit: "ug", group: "micro", target: 400, default_target: 400, auto_from: "RDA" },
    { key: "omega3_g", label: "Omega-3", unit: "g", group: "micro", target: 2, default_target: 2, auto_from: null },
  ],
};
