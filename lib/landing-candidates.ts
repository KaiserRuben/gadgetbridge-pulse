import "server-only";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";

import {
  computeLandingCandidates,
  type LandingCandidate,
  type LandingDomain,
  type LandingTimeframe,
} from "@/runner/analyzer/landing-candidates-core.ts";

/**
 * Stage A — landing candidate generator (Next.js wrapper).
 *
 * Pure compute, no LLM. Single source of truth for the math lives in
 * `runner/src/analyzer/landing-candidates-core.ts` so the smoke probe
 * (plain tsx) can re-use it without dragging `import "server-only"` or
 * `next/cache` into bare-Node land.
 *
 * Architectural principle (locked in PROBE_pattern_naming_and_surprise.md):
 * math computes, LLM frames. The curator never decides if a value is
 * "surprising"; it picks among already-labelled, ranked options.
 */

export type { LandingCandidate, LandingDomain, LandingTimeframe };

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT =
  process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

/**
 * Compute one flat list of landing-page candidates for `latestDate`.
 *
 * Per metric × timeframe (today / trailing_7d / trailing_30d), see
 * `landing-candidates-core.ts` for the math. "low" candidates are dropped
 * unless their domain would otherwise be empty — every domain ships at
 * least one candidate so the curator can populate per-section annotations.
 */
export async function getLandingCandidates(
  latestDate: string,
): Promise<LandingCandidate[]> {
  noStore();
  return computeLandingCandidates(INSIGHTS_ROOT, latestDate);
}
