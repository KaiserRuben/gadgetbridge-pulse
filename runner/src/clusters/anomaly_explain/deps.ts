/**
 * anomaly_explain — dependency declaration.
 *
 * Anomaly explanations are user-triggered (chart click / driver "Warum?"
 * button), not auto-staled by data events. We never want a sleep_complete
 * or workout_complete to silently invalidate the user's just-rendered
 * explanation card. The user re-asks; we recompute.
 *
 * Future enhancement: stale when the underlying `_facts.json` window for
 * the same `periodKey` materially shifts (e.g. a late workout import
 * changes the 7-day deltas the LLM cited). Out of scope for v1 — the
 * existing file cache already serves cross-Sync replays, and the JobCell
 * row is cheap to re-enqueue manually.
 */

import type { PulseEvent } from "../../events/bus.ts";
import type { CellKey } from "../../jobs/cell.ts";

export function deps(_event: PulseEvent): CellKey[] {
  return [];
}
