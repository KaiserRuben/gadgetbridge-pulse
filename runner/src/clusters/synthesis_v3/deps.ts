/**
 * synthesis_v3 — dependency declaration.
 *
 * Three event kinds invalidate a synthesis cell:
 *   - `day_end`          — the day's facts/insights are now final; the
 *                          synthesis should be regenerated against the
 *                          end-of-day numbers. This is the primary
 *                          trigger for the daily_v3 surface.
 *   - `sleep_complete`   — sleep + recovery clusters re-ran, so the
 *                          synthesis inputs changed. The morning
 *                          briefing also fires on sleep_complete, and
 *                          the synthesis hero on the home page should
 *                          stay in lockstep.
 *   - `workout_complete` — activity cluster re-ran; synthesis cites
 *                          activity KPIs (volume_load, training_quality)
 *                          and a fresh workout invalidates that hand.
 *
 * Other event kinds (meal_*, manual) are no-ops — `manual` already
 * fans out to `onDayEnd` in the legacy subscribers path.
 *
 * The legacy `runSynthesis` caller fires on `day_end` (via `runV3` in
 * `v3-orchestrator.ts`); during the dual-write window the legacy writer
 * keeps `daily_v3.json` fresh, and the cell row flips to pending so the
 * cluster path can re-run (auto when `settings:auto_process:synthesis_v3`
 * is on, manual via the dashboard CTA otherwise).
 */

import type { PulseEvent } from "../../events/bus.ts";
import type { CellKey } from "../../jobs/cell.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function deps(event: PulseEvent): CellKey[] {
  if (
    event.kind !== "day_end" &&
    event.kind !== "sleep_complete" &&
    event.kind !== "workout_complete"
  ) {
    return [];
  }
  if (!DATE_RE.test(event.periodKey)) return [];
  return [
    {
      cluster: "synthesis_v3",
      key: event.periodKey,
      scope: "daily",
    },
  ];
}
