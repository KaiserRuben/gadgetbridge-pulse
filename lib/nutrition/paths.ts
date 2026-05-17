import "server-only";

import path from "node:path";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";

const mealsRoot = process.env.PULSE_MEALS_ROOT ?? path.join(SYNC_ROOT, "meals");

export const nutritionPaths = {
  mealsRoot,
  inboxRoot: path.join(mealsRoot, "inbox"),
  photosRoot: path.join(mealsRoot, "photos"),
  recordsRoot: path.join(mealsRoot, "records"),
  targetsFile: path.join(mealsRoot, "targets.json"),
} as const;

export function inboxPathFor(periodKey: string, filename: string): string {
  return path.join(nutritionPaths.inboxRoot, periodKey, filename);
}

export function photoPathFor(periodKey: string, filename: string): string {
  return path.join(nutritionPaths.photosRoot, periodKey, filename);
}

export function recordPathFor(periodKey: string, mealId: string): string {
  return path.join(nutritionPaths.recordsRoot, periodKey, `${mealId}.json`);
}
