/**
 * Phase D: wearable stitching policy.
 *
 * `lib/training/wearable-stitch.ts` is a pure function over (session,
 * candidates), so the test lives runner-side to keep one vitest harness
 * for all training logic. The function does not import server-only.
 */

import { describe, expect, it } from "vitest";

import {
  evaluateStitch,
  STITCH_MIN_OVERLAP,
  STITCH_DURATION_BAND,
  type WearableCandidate,
} from "../../../../../lib/training/wearable-stitch.ts";

function isoFromUnix(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

function makeCandidate(
  id: number,
  startSec: number,
  durationSec: number,
  periodKey = "2026-05-16",
): WearableCandidate {
  return {
    id,
    startTs: startSec,
    endTs: startSec + durationSec,
    periodKey,
    typeLabel: "Krafttraining",
  };
}

describe("wearable-stitch policy", () => {
  const SESSION_START = 1_750_000_000;
  const SESSION_END = SESSION_START + 60 * 60; // 60 min
  const session = {
    started_at: isoFromUnix(SESSION_START),
    completed_at: isoFromUnix(SESSION_END),
    period_key: "2026-05-16",
  };

  it("declines stitching for an unfinished session", () => {
    const outcome = evaluateStitch({
      session: { ...session, completed_at: null },
      candidates: [makeCandidate(1, SESSION_START, 60 * 60)],
    });
    expect(outcome.reason).toBe("session_incomplete");
    expect(outcome.pick).toBeNull();
  });

  it("returns no_candidates when nothing in window", () => {
    const outcome = evaluateStitch({ session, candidates: [] });
    expect(outcome.reason).toBe("no_candidates");
  });

  it("auto-links a candidate with high IoU + same duration band", () => {
    const candidate = makeCandidate(42, SESSION_START + 5 * 60, 50 * 60);
    const outcome = evaluateStitch({
      session,
      candidates: [candidate],
      now: new Date((SESSION_END + 60) * 1000),
    });
    expect(outcome.reason).toBe("auto_linked");
    expect(outcome.pick?.id).toBe(42);
    expect(outcome.status).toBe("tentative");
  });

  it("flips to confirmed after the 24h tentative window", () => {
    const candidate = makeCandidate(42, SESSION_START, 60 * 60);
    const outcome = evaluateStitch({
      session,
      candidates: [candidate],
      now: new Date((SESSION_END + 26 * 60 * 60) * 1000),
    });
    expect(outcome.status).toBe("confirmed");
  });

  it("refuses to auto-link when IoU is below the threshold", () => {
    // 5-min overlap inside 60-min session vs 10-min wearable: IoU 5/65 ≈ 0.08
    const candidate = makeCandidate(7, SESSION_END - 5 * 60, 10 * 60);
    const outcome = evaluateStitch({ session, candidates: [candidate] });
    expect(outcome.reason).toBe("no_overlap_pass");
    expect(outcome.pick).toBeNull();
    expect(STITCH_MIN_OVERLAP).toBe(0.6);
  });

  it("refuses to auto-link when duration ratio is outside [0.5, 2.0]", () => {
    // 60-min session vs 10-min wearable, ratio 6.0 → out of band.
    const candidate = makeCandidate(8, SESSION_START + 5 * 60, 10 * 60);
    const outcome = evaluateStitch({ session, candidates: [candidate] });
    expect(outcome.reason).toBe("no_overlap_pass");
    expect(STITCH_DURATION_BAND).toEqual([0.5, 2.0]);
  });

  it("returns multiple_candidates when two wearable workouts neighbour the session", () => {
    // Both overlap nicely; presence of two is ambiguity → user picks manually.
    const a = makeCandidate(1, SESSION_START, 60 * 60);
    const b = makeCandidate(2, SESSION_START + 70 * 60, 60 * 60);
    const outcome = evaluateStitch({ session, candidates: [a, b] });
    expect(outcome.reason).toBe("multiple_candidates");
    expect(outcome.pick).toBeNull();
    expect(outcome.alternatives.map((c) => c.id).sort()).toEqual([1, 2]);
  });

  it("rejects candidates from a different period_key", () => {
    const c = makeCandidate(99, SESSION_START, 60 * 60, "2026-05-15");
    const outcome = evaluateStitch({ session, candidates: [c] });
    expect(outcome.reason).toBe("no_overlap_pass");
  });
});
