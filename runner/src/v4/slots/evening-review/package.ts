/**
 * Evening-review packager.
 *
 * Reads midday_check (prior) + tier1.kpis_today (full day signals) +
 * workouts list. No DB reads — tier1 has the workouts already.
 */

import {
  loadPriorSlot,
  shortHash,
  type PriorSlotPayload,
  type SlotBuildContext,
  type SlotPackage,
} from "../_shared.ts";
import type { MiddayCheckPayload } from "../midday-check/types.ts";
import type { KpiWorkout } from "../../types.ts";

export interface EveningDomain {
  evening_window: {
    generated_at_iso: string;
    local_hour: number;
    minutes_until_typical_bedtime: number | null;
  };
  /** Pulled from tier1.kpis_today.workouts — surfaced explicitly for prose convenience. */
  workouts_today: KpiWorkout[];
}

export type EveningReviewPackage = SlotPackage<EveningDomain> & {
  prior: { midday_check: PriorSlotPayload<MiddayCheckPayload> };
};

const TYPICAL_BEDTIME_HOUR = 23;

export async function buildEveningReviewPackage(
  ctx: SlotBuildContext,
): Promise<EveningReviewPackage> {
  const midday = await loadPriorSlot<MiddayCheckPayload>(ctx, "midday_check");
  const localHour = parseLocalHour(ctx.now, ctx.tz);
  const minutesUntilBed =
    localHour < TYPICAL_BEDTIME_HOUR ? (TYPICAL_BEDTIME_HOUR - localHour) * 60 : null;

  return {
    meta: {
      period_key: ctx.period_key,
      generated_at: ctx.now.toISOString(),
      tz: ctx.tz,
      package_version: "evening-review-package/v1",
    },
    tier1_snapshot: ctx.tier1,
    prior: { midday_check: midday },
    domain: {
      evening_window: {
        generated_at_iso: ctx.now.toISOString(),
        local_hour: localHour,
        minutes_until_typical_bedtime: minutesUntilBed,
      },
      workouts_today: ctx.tier1.kpis_today.workouts,
    },
  };
}

export function eveningReviewFactsHash(pkg: EveningReviewPackage): string {
  return shortHash({
    period_key: pkg.meta.period_key,
    midday_at: pkg.prior.midday_check.computed_at,
    steps: pkg.tier1_snapshot.kpis_today.steps,
    kcal: pkg.tier1_snapshot.kpis_today.active_kcal,
    workouts: pkg.domain.workouts_today.map((w) => `${w.ts_start_iso}|${w.kind}`),
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
