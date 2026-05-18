/**
 * Pure derivation helpers for `<DerivedCell>` chrome — the freshness chip,
 * provenance prominence rules, etc. All deterministic, no React, so the
 * runner's vitest suite can hit them without a DOM.
 *
 * Conventions:
 *  - "fresh" means `state === "ready_fresh"` AND we are within
 *    `FRESH_WINDOW_MS` of `updated_at`. Past that window, the payload is
 *    still server-fresh but we stop bragging about it.
 *  - "aus Cache" surfaces whenever the server returns `ready_cached`, even
 *    if the underlying payload is identical to a freshly-computed one.
 *    The user-visible distinction is: "is the bundle this came from still
 *    the latest one the runner has acked?"
 *  - Reprocessing has its own InProgressBadge, so the freshness pill is
 *    suppressed in that state.
 */

import type { CellState } from "./state.ts";
import type { ProvenanceTag } from "@/runner/jobs/types";

/** Window in which a `ready_fresh` cell still earns the "gerade berechnet" tag. */
export const FRESH_WINDOW_MS = 5 * 60 * 1000;

/** Discriminated descriptor that callers turn into a `<Pill>` (or null). */
export type FreshnessPill =
  | { kind: "fresh"; label: "gerade berechnet"; tone: "up" }
  | { kind: "cached"; label: "aus Cache"; tone: "low" }
  | null;

/**
 * Decide which status pill (if any) sits next to a cell's title.
 *
 * @param state    Current cell state (client-folded).
 * @param updatedAtIso  Server-reported `updated_at` ISO timestamp.
 * @param nowMs    Current wall-clock ms; injected for determinism in tests.
 */
export function freshnessPill(
  state: CellState,
  updatedAtIso: string | null,
  nowMs: number,
): FreshnessPill {
  switch (state) {
    case "ready_fresh": {
      if (!updatedAtIso) return null;
      const updatedMs = Date.parse(updatedAtIso);
      if (!Number.isFinite(updatedMs)) return null;
      const age = nowMs - updatedMs;
      if (age >= 0 && age < FRESH_WINDOW_MS) {
        return { kind: "fresh", label: "gerade berechnet", tone: "up" };
      }
      return null;
    }
    case "ready_cached":
      return { kind: "cached", label: "aus Cache", tone: "low" };
    case "reprocessing":
    case "fetching":
    case "error":
    case "never_computed":
    default:
      return null;
  }
}

/**
 * True when any tag carries the `user_edited` provenance source. Cells that
 * use the always-visible row instead of the chip need to render their own
 * "Bearbeitet" prominence pill (the chip handles this internally).
 */
export function hasUserEdit(tags: ProvenanceTag[] | null | undefined): boolean {
  if (!tags) return false;
  for (const t of tags) {
    if (t.source === "user_edited") return true;
  }
  return false;
}
