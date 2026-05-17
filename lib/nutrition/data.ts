import "server-only";

/**
 * Pulse-DB-backed nutrition data accessors.
 *
 * UI pages import from here, not `fixtures.ts`. Day-pattern reads come from
 * PULSE_INSIGHT cluster='nutrition' once the v3 cluster lands; until then,
 * `getDayPattern` synthesises events deterministically from the day's meals
 * so the UI degrades gracefully on insight-less days.
 *
 * Targets live in PULSE_STATE_KV key='nutrition_targets' once edited; the
 * default rows ship in `fixtures.ts` and are used as the fallback.
 */

import {
  listMealsForPeriod,
  readMeal,
} from "@/lib/data/meal-store";
import { readInsight, readStateKv } from "@/lib/data/period-store";
import { addDays, todayKey } from "@/lib/time";
import {
  DEFAULT_TARGETS,
  effectiveTarget,
  eventsFromMeals,
  sum,
} from "./helpers";
import type {
  DayPatternBlock,
  Meal,
  NutrientTarget,
  NutritionFacts,
  NutritionTargets,
} from "./types";

export function getTodayDate(): string {
  return todayKey();
}

export function getMealById(id: string): Meal | null {
  return readMeal(id);
}

export function getMealsForDate(date: string): Meal[] {
  return listMealsForPeriod(date);
}

export function getRecentMeals(limit = 12): Meal[] {
  const today = todayKey();
  const out: Meal[] = [];
  for (let i = 0; i < 14 && out.length < limit; i++) {
    const date = addDays(today, -i);
    out.push(...listMealsForPeriod(date));
  }
  return out
    .sort((a, b) => Date.parse(b.user_meal_at) - Date.parse(a.user_meal_at))
    .slice(0, limit);
}

/** All meals in `[end - days + 1, end]`. Used by the trends page. */
export function getMealsWindow(end: string, days: number): Meal[] {
  const out: Meal[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(...listMealsForPeriod(addDays(end, -i)));
  }
  return out;
}

export function getTargets(): NutritionTargets {
  const stored = readStateKv<NutritionTargets>("nutrition_targets");
  if (stored && Array.isArray(stored.rows)) return stored;
  return DEFAULT_TARGETS;
}

export { effectiveTarget };

export function dayTotals(date: string): NutritionFacts {
  return sum(getMealsForDate(date).map((m) => m.totals));
}

function deltaVsTarget(
  totals: NutritionFacts,
  targets: NutritionTargets,
): DayPatternBlock["delta_vs_target"] {
  const out: DayPatternBlock["delta_vs_target"] = {};
  for (const t of targets.rows) {
    const target = effectiveTarget(t);
    if (target == null) continue;
    const actual = (totals as unknown as Record<string, number | undefined>)[t.key];
    if (typeof actual !== "number") continue;
    (out as Record<string, number>)[t.key] = round(actual - target);
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function getDayPattern(date: string): DayPatternBlock {
  const insight = readInsight<DayPatternBlock>(date, "nutrition");
  if (insight?.payload) return insight.payload;

  // Fallback: synthesise from meals so the UI renders before the cluster runs.
  const meals = getMealsForDate(date);
  const targets = getTargets();
  const totals = sum(meals.map((m) => m.totals));
  const flags = meals.length === 0 ? ["no_meals_logged"] : [];
  return {
    period_key: date,
    totals,
    delta_vs_target: deltaVsTarget(totals, targets),
    events: eventsFromMeals(meals),
    flags,
    meals_count: meals.length,
    day_complete: date < todayKey(),
  };
}

/**
 * Day-page bottom-block aggregate. Returns null when smart-hide applies:
 *   - day not complete, OR
 *   - zero meals logged.
 */
export function getDayNutritionAggregate(date: string): DayPatternBlock | null {
  const block = getDayPattern(date);
  if (!block.day_complete) return null;
  if (block.meals_count === 0) return null;
  return block;
}

export function getWeekStrip(
  end: string,
  days = 7,
): Array<{ date: string; totals: NutritionFacts; meals_count: number }> {
  const out: Array<{ date: string; totals: NutritionFacts; meals_count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(end, -i);
    const meals = getMealsForDate(date);
    out.push({
      date,
      totals: sum(meals.map((m) => m.totals)),
      meals_count: meals.length,
    });
  }
  return out;
}

export type { NutrientTarget };
