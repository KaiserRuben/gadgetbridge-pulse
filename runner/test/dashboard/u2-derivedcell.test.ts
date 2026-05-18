/**
 * Tests for Phase U2 DerivedCell refinement. Covers the pure derivation
 * helpers: cluster-tone lookup, freshness/cached pill logic, the
 * user-edit predicate. React renders (chip vs row, modal mount, motion-
 * prefs) are left to the dashboard build — vitest's config doesn't pull
 * the DOM in, so we lock the data shapes here and let tsc + build pick
 * up the React side.
 *
 * Imports cross the dashboard ↔ runner boundary via relative paths to
 * match the alias setup used by `u1-primitives.test.ts` etc.
 */

import { describe, expect, it } from "vitest";

import {
  freshnessPill,
  hasUserEdit,
  FRESH_WINDOW_MS,
} from "../../../lib/derived/cell-status.ts";
import { clusterTone } from "../../../lib/derived/cluster-tone.ts";
import type { ProvenanceTag } from "../../../runner/src/jobs/types.ts";

describe("clusterTone", () => {
  it("maps synthesis / morning briefing / weekly recap → sleep", () => {
    expect(clusterTone("synthesis_v3")).toBe("sleep");
    expect(clusterTone("morning_insight")).toBe("sleep");
    expect(clusterTone("weekly_recap")).toBe("sleep");
  });

  it("maps anomaly_explain → heart", () => {
    expect(clusterTone("anomaly_explain")).toBe("heart");
  });

  it("maps per-domain insight clusters to their domain", () => {
    expect(clusterTone("sleep_insight")).toBe("sleep");
    expect(clusterTone("recovery_insight")).toBe("sleep");
    expect(clusterTone("activity_insight")).toBe("activity");
    expect(clusterTone("stress_insight")).toBe("stress");
    expect(clusterTone("nutrition_meal")).toBe("nutrition");
  });

  it("falls back to neutral for unknown clusters", () => {
    expect(clusterTone("totally_made_up")).toBe("neutral");
    expect(clusterTone("")).toBe("neutral");
  });
});

describe("freshnessPill", () => {
  const NOW = Date.parse("2026-05-17T12:00:00Z");

  function isoMinutesAgo(min: number): string {
    return new Date(NOW - min * 60_000).toISOString();
  }

  it("returns 'gerade berechnet' (up) for ready_fresh within 5 minutes", () => {
    const pill = freshnessPill("ready_fresh", isoMinutesAgo(2), NOW);
    expect(pill).not.toBeNull();
    expect(pill?.label).toBe("gerade berechnet");
    expect(pill?.tone).toBe("up");
  });

  it("returns null for ready_fresh older than 5 minutes", () => {
    expect(freshnessPill("ready_fresh", isoMinutesAgo(10), NOW)).toBeNull();
  });

  it("returns null for ready_fresh exactly at the 5-minute boundary", () => {
    // freshness window is half-open [0, FRESH_WINDOW_MS)
    const boundary = new Date(NOW - FRESH_WINDOW_MS).toISOString();
    expect(freshnessPill("ready_fresh", boundary, NOW)).toBeNull();
  });

  it("returns 'aus Cache' (low) for ready_cached regardless of age", () => {
    const pill = freshnessPill("ready_cached", isoMinutesAgo(30), NOW);
    expect(pill?.label).toBe("aus Cache");
    expect(pill?.tone).toBe("low");
  });

  it("returns null for reprocessing (reprocessing badge owns the slot)", () => {
    expect(freshnessPill("reprocessing", isoMinutesAgo(1), NOW)).toBeNull();
  });

  it("returns null for fetching / error / never_computed", () => {
    expect(freshnessPill("fetching", null, NOW)).toBeNull();
    expect(freshnessPill("error", isoMinutesAgo(1), NOW)).toBeNull();
    expect(freshnessPill("never_computed", null, NOW)).toBeNull();
  });

  it("returns null when ready_fresh has no updated_at", () => {
    expect(freshnessPill("ready_fresh", null, NOW)).toBeNull();
  });

  it("returns null when updated_at is unparseable", () => {
    expect(freshnessPill("ready_fresh", "not-an-iso", NOW)).toBeNull();
  });

  it("does not surface 'gerade berechnet' when updated_at is in the future", () => {
    const future = new Date(NOW + 60_000).toISOString();
    // age would be negative; treat as not-fresh to avoid clock-skew weirdness
    expect(freshnessPill("ready_fresh", future, NOW)).toBeNull();
  });
});

describe("hasUserEdit", () => {
  function tag(source: ProvenanceTag["source"]): ProvenanceTag {
    return { field_path: "anything", source };
  }

  it("returns true when any tag has source: user_edited", () => {
    expect(
      hasUserEdit([tag("vlm_inferred"), tag("user_edited"), tag("llm_derived")]),
    ).toBe(true);
  });

  it("returns false when no tag is user_edited", () => {
    expect(
      hasUserEdit([
        tag("vlm_inferred"),
        tag("llm_derived"),
        tag("wearable_sensor"),
      ]),
    ).toBe(false);
  });

  it("returns false for empty or null inputs", () => {
    expect(hasUserEdit([])).toBe(false);
    expect(hasUserEdit(null)).toBe(false);
    expect(hasUserEdit(undefined)).toBe(false);
  });

  it("is true even when user_edited is the only tag", () => {
    expect(hasUserEdit([tag("user_edited")])).toBe(true);
  });
});
