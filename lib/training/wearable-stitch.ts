/**
 * Wearable-to-session stitching.
 *
 * Rule (per docs/TRAINING_PLAN_DESIGN.md §Q4):
 *   auto_link iff overlap_ratio >= 0.60 (intersection / union)
 *             AND duration_ratio in [0.5, 2.0]      (user / wearable)
 *             AND same period_key                    (wake-date local)
 *             AND sole candidate within ±30 min of session window
 *
 * Tentative for 24h, confirmed otherwise. Multiple candidates → no auto-link,
 * UI surfaces a manual picker.
 *
 * Pure function over (session, candidates) — caller pulls wearable
 * candidates from Gadgetbridge.db via lib/queries/workouts.
 */

export const STITCH_MIN_OVERLAP = 0.6;
export const STITCH_DURATION_BAND = [0.5, 2.0] as const;
export const STITCH_NEIGHBOUR_WINDOW_SEC = 30 * 60;

export interface WearableCandidate {
  id: number;
  /** Unix seconds. */
  startTs: number;
  /** Unix seconds. */
  endTs: number;
  /** Wake-date local key (caller assigns; period.ts helpers). */
  periodKey: string;
  typeLabel: string;
}

export interface StitchOutcome {
  pick: WearableCandidate | null;
  status: "tentative" | "confirmed" | "manual" | "none";
  reason:
    | "no_candidates"
    | "no_overlap_pass"
    | "multiple_candidates"
    | "auto_linked"
    | "session_incomplete";
  alternatives: WearableCandidate[];
}

/** Default policy: auto-confirm a stitch older than this. */
export const STITCH_TENTATIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface SessionWindow {
  started_at: string;
  completed_at: string | null;
  period_key: string;
}

interface StitchInput {
  session: SessionWindow;
  candidates: WearableCandidate[];
  now?: Date;
}

function toUnixSec(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function overlapRatio(
  sStart: number,
  sEnd: number,
  wStart: number,
  wEnd: number,
): number {
  const inter = Math.max(0, Math.min(sEnd, wEnd) - Math.max(sStart, wStart));
  if (inter <= 0) return 0;
  const union = Math.max(sEnd, wEnd) - Math.min(sStart, wStart);
  return union > 0 ? inter / union : 0;
}

export function evaluateStitch(input: StitchInput): StitchOutcome {
  if (!input.session.completed_at) {
    return {
      pick: null,
      status: "none",
      reason: "session_incomplete",
      alternatives: [],
    };
  }
  if (input.candidates.length === 0) {
    return {
      pick: null,
      status: "none",
      reason: "no_candidates",
      alternatives: [],
    };
  }

  const sStart = toUnixSec(input.session.started_at);
  const sEnd = toUnixSec(input.session.completed_at);
  const sDuration = sEnd - sStart;

  // First pass: hard filters.
  const passing: WearableCandidate[] = [];
  for (const c of input.candidates) {
    if (c.periodKey !== input.session.period_key) continue;
    const wDuration = c.endTs - c.startTs;
    if (wDuration <= 0) continue;
    const ratio = overlapRatio(sStart, sEnd, c.startTs, c.endTs);
    if (ratio < STITCH_MIN_OVERLAP) continue;
    const durRatio = sDuration > 0 ? sDuration / wDuration : 0;
    if (durRatio < STITCH_DURATION_BAND[0] || durRatio > STITCH_DURATION_BAND[1]) continue;
    passing.push(c);
  }

  // Sole-candidate-in-neighbourhood guard: count every wearable workout that
  // falls within ±30 min of the session window — even if its own overlap is
  // below the threshold, two concurrent workouts indicate ambiguity.
  const neighbours = input.candidates.filter((c) => {
    if (c.periodKey !== input.session.period_key) return false;
    if (c.endTs < sStart - STITCH_NEIGHBOUR_WINDOW_SEC) return false;
    if (c.startTs > sEnd + STITCH_NEIGHBOUR_WINDOW_SEC) return false;
    return true;
  });

  if (passing.length === 0) {
    return {
      pick: null,
      status: "none",
      reason: "no_overlap_pass",
      alternatives: neighbours,
    };
  }

  if (passing.length > 1 || neighbours.length > 1) {
    return {
      pick: null,
      status: "none",
      reason: "multiple_candidates",
      alternatives: neighbours,
    };
  }

  // Single passing candidate, single neighbour: auto-link.
  const pick = passing[0];
  const now = input.now ?? new Date();
  const completedMs = new Date(input.session.completed_at).getTime();
  const ageMs = now.getTime() - completedMs;
  const status: StitchOutcome["status"] =
    ageMs >= STITCH_TENTATIVE_WINDOW_MS ? "confirmed" : "tentative";

  return {
    pick,
    status,
    reason: "auto_linked",
    alternatives: neighbours.filter((c) => c.id !== pick.id),
  };
}
