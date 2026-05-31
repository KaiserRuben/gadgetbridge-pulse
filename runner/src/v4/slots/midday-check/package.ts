/**
 * Midday-check packager.
 *
 * Reads morning_briefing (prior) + tier1.kpis_today (current mid-day state).
 * No DB reads — tier1 already aggregated. domain adds the local-hour and a
 * coarse "step pace" vs the simplified expectation curve.
 */

import {
  loadPriorSlot,
  shortHash,
  type PriorSlotPayload,
  type SlotBuildContext,
  type SlotPackage,
} from "../_shared.ts";
import type { MorningBriefingPayload } from "../morning-briefing/types.ts";

export interface MiddayDomain {
  midday_window: {
    generated_at_iso: string;
    local_hour: number;
    /** Simple expected steps for the time of day: hour * 600 (placeholder; tweak via Tier-1). */
    expected_steps_by_now: number;
    /** Actual steps_so_far / expected ratio, 1.0 = on pace, 0.0 = no movement. */
    pace_ratio: number | null;
  };
}

export type MiddayCheckPackage = SlotPackage<MiddayDomain> & {
  prior: { morning_briefing: PriorSlotPayload<MorningBriefingPayload> };
};

export async function buildMiddayCheckPackage(
  ctx: SlotBuildContext,
): Promise<MiddayCheckPackage> {
  const morning = await loadPriorSlot<MorningBriefingPayload>(ctx, "morning_briefing");
  const localHour = parseLocalHour(ctx.now, ctx.tz);
  const expected = Math.max(0, localHour * 600);
  const stepsNow = ctx.tier1.kpis_today.steps;
  const paceRatio =
    stepsNow != null && expected > 0 ? Math.round((stepsNow / expected) * 100) / 100 : null;

  return {
    meta: {
      period_key: ctx.period_key,
      generated_at: ctx.now.toISOString(),
      tz: ctx.tz,
      package_version: "midday-check-package/v1",
    },
    tier1_snapshot: ctx.tier1,
    prior: { morning_briefing: morning },
    domain: {
      midday_window: {
        generated_at_iso: ctx.now.toISOString(),
        local_hour: localHour,
        expected_steps_by_now: expected,
        pace_ratio: paceRatio,
      },
    },
  };
}

export function middayCheckFactsHash(pkg: MiddayCheckPackage): string {
  return shortHash({
    period_key: pkg.meta.period_key,
    morning_at: pkg.prior.morning_briefing.computed_at,
    steps: pkg.tier1_snapshot.kpis_today.steps,
    hr_now: pkg.tier1_snapshot.facts_now.hr_now,
    pain: pkg.tier1_snapshot.context.pain_flags_active,
  });
}

function parseLocalHour(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}
