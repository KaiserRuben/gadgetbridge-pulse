import "server-only";

import { pulseDb } from "../pulse-db";

/**
 * Server-side engagement gate for the soft consent card.
 *
 * Two cheap checks against pulse.db:
 *   1. At least one finalized day in PULSE_BUNDLE (status='complete').
 *   2. At least one classified meal in PULSE_MEAL.
 *
 * Both signals together prove the user has lived with the dashboard long
 * enough to know what a notification would actually carry. Until then we
 * stay silent — the worst possible move is to ask permission before the
 * user has any reason to grant it.
 */
export function isEngagementCriteriaMet(): boolean {
  const db = pulseDb();
  if (!db) return false;
  try {
    const finalizedDay = db
      .prepare<[], { c: number }>(
        `SELECT COUNT(*) AS c FROM PULSE_BUNDLE WHERE status = 'complete' LIMIT 1`,
      )
      .get();
    if (!finalizedDay || finalizedDay.c === 0) return false;

    const classifiedMeal = db
      .prepare<[], { c: number }>(
        `SELECT COUNT(*) AS c FROM PULSE_MEAL WHERE status IN ('classified','edited') LIMIT 1`,
      )
      .get();
    if (!classifiedMeal || classifiedMeal.c === 0) return false;

    return true;
  } catch {
    return false;
  }
}
