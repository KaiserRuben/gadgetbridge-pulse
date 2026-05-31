/**
 * Day-synthesis packager.
 *
 * Reads all 4 prior daily-slot payloads + tier1. Hard-dep on evening_review
 * (per registry); soft-loads the rest. Caller (`runDaySynthesis`) checks
 * `prior.evening_review.status` and either runs the slot normally or marks
 * the SlotEntry as degraded with `degraded_reason` set.
 */

import {
  loadPriorSlot,
  shortHash,
  type PriorSlotPayload,
  type SlotBuildContext,
  type SlotPackage,
} from "../_shared.ts";
import type { NightReviewPayload } from "../night-review/types.ts";
import type { MorningBriefingPayload } from "../morning-briefing/types.ts";
import type { MiddayCheckPayload } from "../midday-check/types.ts";
import type { EveningReviewPayload } from "../evening-review/types.ts";

export interface DaySynthesisPrior {
  night_review: PriorSlotPayload<NightReviewPayload>;
  morning_briefing: PriorSlotPayload<MorningBriefingPayload>;
  midday_check: PriorSlotPayload<MiddayCheckPayload>;
  evening_review: PriorSlotPayload<EveningReviewPayload>;
}

export interface DaySynthesisDomain {
  /** Which priors are present and usable. */
  prior_coverage: {
    has_night_review: boolean;
    has_morning_briefing: boolean;
    has_midday_check: boolean;
    has_evening_review: boolean;
    /** Slots with status not in {fresh, aging}. */
    missing_or_stale: string[];
  };
}

export type DaySynthesisPackage = SlotPackage<DaySynthesisDomain> & {
  prior: DaySynthesisPrior;
};

const USABLE_STATUSES = new Set(["fresh", "aging", "stale", "degraded"]);

export async function buildDaySynthesisPackage(
  ctx: SlotBuildContext,
): Promise<DaySynthesisPackage> {
  const [night, morning, midday, evening] = await Promise.all([
    loadPriorSlot<NightReviewPayload>(ctx, "night_review"),
    loadPriorSlot<MorningBriefingPayload>(ctx, "morning_briefing"),
    loadPriorSlot<MiddayCheckPayload>(ctx, "midday_check"),
    loadPriorSlot<EveningReviewPayload>(ctx, "evening_review"),
  ]);

  const has = (p: PriorSlotPayload): boolean =>
    USABLE_STATUSES.has(p.status) && p.payload !== null;

  const missingOrStale: string[] = [];
  if (!has(night)) missingOrStale.push("night_review");
  if (!has(morning)) missingOrStale.push("morning_briefing");
  if (!has(midday)) missingOrStale.push("midday_check");
  if (!has(evening)) missingOrStale.push("evening_review");

  return {
    meta: {
      period_key: ctx.period_key,
      generated_at: ctx.now.toISOString(),
      tz: ctx.tz,
      package_version: "day-synthesis-package/v1",
    },
    tier1_snapshot: ctx.tier1,
    prior: {
      night_review: night,
      morning_briefing: morning,
      midday_check: midday,
      evening_review: evening,
    },
    domain: {
      prior_coverage: {
        has_night_review: has(night),
        has_morning_briefing: has(morning),
        has_midday_check: has(midday),
        has_evening_review: has(evening),
        missing_or_stale: missingOrStale,
      },
    },
  };
}

export function daySynthesisFactsHash(pkg: DaySynthesisPackage): string {
  return shortHash({
    period_key: pkg.meta.period_key,
    night_at: pkg.prior.night_review.computed_at,
    morning_at: pkg.prior.morning_briefing.computed_at,
    midday_at: pkg.prior.midday_check.computed_at,
    evening_at: pkg.prior.evening_review.computed_at,
    kpis: pkg.tier1_snapshot.kpis_today,
  });
}
