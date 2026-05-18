/**
 * morning_insight — dependency declaration.
 *
 * Two event kinds invalidate a morning cell:
 *   - `day_end`         — the day's facts/insights are now final; the
 *                          briefing should be regenerated against the
 *                          end-of-day numbers (in practice the same
 *                          run that closes the day also fires
 *                          `sleep_complete`, but day_end stays for
 *                          backfills and manual triggers).
 *   - `sleep_complete`  — the night just landed; the morning briefing
 *                          consumes sleep + recovery cluster outputs
 *                          and the night's facts, so a fresh sleep
 *                          arrival should bump the cell to pending.
 *
 * Other event kinds (workout_complete, meal_*) are no-ops — a morning
 * briefing already-written for the day doesn't stale on a workout. The
 * legacy `runV3Cluster("morning", …)` caller fires on `sleep_complete`
 * and `day_end` directly (see `events/subscribers.ts`). To avoid 2× GPU
 * cost, the cell-dispatcher's `LEGACY_HANDLES` table skips auto-enqueue
 * for those event×cluster pairs — the legacy writer's pushInsight flips
 * the cell back to 'complete'. Stale signal still fires so the row
 * tracks the event; manual re-runs via the dashboard CTA still work.
 */

import type { PulseEvent } from "../../events/bus.ts";
import type { CellKey } from "../../jobs/cell.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function deps(event: PulseEvent): CellKey[] {
  if (event.kind !== "day_end" && event.kind !== "sleep_complete") return [];
  if (!DATE_RE.test(event.periodKey)) return [];
  return [
    {
      cluster: "morning_insight",
      key: event.periodKey,
      scope: "daily",
    },
  ];
}
