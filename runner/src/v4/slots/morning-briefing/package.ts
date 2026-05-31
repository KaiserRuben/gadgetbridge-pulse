/**
 * Morning-briefing packager.
 *
 * Input:
 *   prior.night_review.payload   — last-night review (headline, kpis, deltas)
 *   tier1_snapshot.context        — plan_session_today, pain_flags_active, anomalies_today
 *   tier1_snapshot.kpis_today     — current numbers (RHR_day, etc.)
 *   domain.morning_window         — light deterministic compute (time of day, since-wake hours)
 *
 * No DB reads — relies entirely on tier1 + prior. Keeps slot pure for retry +
 * deterministic golden fixtures.
 */

import {
  loadPriorSlot,
  shortHash,
  type PriorSlotPayload,
  type SlotBuildContext,
  type SlotPackage,
} from "../_shared.ts";
import type { NightReviewPayload } from "../night-review/types.ts";

export interface MorningWindow {
  /** ISO time when the package was built. */
  generated_at_iso: string;
  /** Local hour-of-day (0..23). */
  local_hour: number;
  /** Minutes since wake_iso (if night_review provided one); null otherwise. */
  minutes_since_wake: number | null;
  /** Whether we're already past 10:00 local — if so, the day is well under way. */
  late_start: boolean;
}

export interface MorningBriefingDomain {
  morning_window: MorningWindow;
}

export interface MorningBriefingPrior {
  night_review: PriorSlotPayload<NightReviewPayload>;
}

export type MorningBriefingPackage = SlotPackage<MorningBriefingDomain> & {
  prior: MorningBriefingPrior;
};

const TZ_DEFAULT = "Europe/Berlin";

export async function buildMorningBriefingPackage(
  ctx: SlotBuildContext,
): Promise<MorningBriefingPackage> {
  const tz = ctx.tz ?? TZ_DEFAULT;
  const night = await loadPriorSlot<NightReviewPayload>(ctx, "night_review");
  const window = buildMorningWindow(ctx.now, night.payload, tz);

  return {
    meta: {
      period_key: ctx.period_key,
      generated_at: ctx.now.toISOString(),
      tz,
      package_version: "morning-briefing-package/v1",
    },
    tier1_snapshot: ctx.tier1,
    prior: { night_review: night },
    domain: { morning_window: window },
  };
}

export function morningBriefingFactsHash(pkg: MorningBriefingPackage): string {
  return shortHash({
    period_key: pkg.meta.period_key,
    night_computed_at: pkg.prior.night_review.computed_at,
    plan: pkg.tier1_snapshot.context.plan_session_today,
    pain: pkg.tier1_snapshot.context.pain_flags_active,
  });
}

function buildMorningWindow(
  now: Date,
  night: NightReviewPayload | null,
  tz: string,
): MorningWindow {
  const localHour = parseLocalHour(now, tz);
  const minutesSinceWake = night?.summary_long
    ? null
    : null;
  return {
    generated_at_iso: now.toISOString(),
    local_hour: localHour,
    minutes_since_wake: minutesSinceWake,
    late_start: localHour >= 10,
  };
}

function parseLocalHour(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}
