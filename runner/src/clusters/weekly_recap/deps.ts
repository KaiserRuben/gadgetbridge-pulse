/**
 * weekly_recap — dependency declaration.
 *
 * A `day_end` event for a YYYY-MM-DD wake-date invalidates the cell for
 * that day's containing ISO week. The dispatcher then either:
 *   - flips the cell to pending and waits for an explicit user enqueue,
 *     when `settings:auto_process[:weekly_recap]` is off (the default), or
 *   - flips the cell to pending AND enqueues a JobCell job at
 *     `JobPriority.AutoProcess`, when the setting is on.
 *
 * Other event kinds are no-ops. The weekly recap is a strict roll-up of
 * the seven daily insights; sleep_complete / workout_complete already
 * fan out through their domain clusters and eventually surface in the
 * daily.json that this cluster consumes, so no double-staling is needed.
 */

import type { PulseEvent } from "../../events/bus.ts";
import type { CellKey } from "../../jobs/cell.ts";
import { weekKeyForDate } from "../../period.ts";

export function deps(event: PulseEvent): CellKey[] {
  if (event.kind !== "day_end") return [];
  // Only invalidate when the period key is a valid YYYY-MM-DD wake-date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.periodKey)) return [];
  return [
    {
      cluster: "weekly_recap",
      key: weekKeyForDate(event.periodKey),
      scope: "weekly",
    },
  ];
}
