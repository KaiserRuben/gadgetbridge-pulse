"use client";

/**
 * MealTimelineRow — the wider, day-view row variant of MealCard. It's a
 * thin convenience wrapper so the day-view import reads intentionally
 * (`<MealTimelineRow … />`) rather than `<MealCard layout="row" />`. Both
 * resolve to the same row renderer; future timeline-only affordances
 * (left-rail tick, expand-in-place, etc.) land here without touching the
 * tile callers.
 */

import { MealCard } from "./MealCard";
import type { Meal } from "@/lib/nutrition/types";

export function MealTimelineRow({
  meal,
  className,
}: {
  meal: Meal;
  className?: string;
}) {
  return <MealCard meal={meal} layout="row" className={className} />;
}
