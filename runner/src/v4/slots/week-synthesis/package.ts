/**
 * Week-synthesis packager.
 *
 * Reads up to 7 daily view-state files for the ISO week, pulling
 * day_synthesis payloads from each. Also reads the weekly view's own
 * tier1 (week-aggregated KPIs).
 *
 * Soft-degrades: if fewer than 5 day_synthesis payloads available, the
 * caller marks SlotEntry.status='degraded' with reason listing missing
 * dates.
 */

import { shortHash, type SlotBuildContext, type SlotPackage } from "../_shared.ts";
import { ViewStateReader } from "../../view-state/reader.ts";
import type { DaySynthesisPayload } from "../day-synthesis/types.ts";

export interface DayInWeek {
  date: string;
  weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  has_synthesis: boolean;
  synthesis: DaySynthesisPayload | null;
  /** Coarse pickout from synthesis.kpis for ranking — null if missing. */
  day_score: number | null;
  day_score_band: string | null;
}

export interface WeekSynthesisDomain {
  /** Mon..Sun listing with synthesis payloads + day_score for ranking. */
  days: DayInWeek[];
  /** Dates where day_synthesis is missing or not yet fresh. */
  missing_or_stale: string[];
}

export type WeekSynthesisPackage = SlotPackage<WeekSynthesisDomain>;

const WEEKDAYS: Array<DayInWeek["weekday"]> = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export async function buildWeekSynthesisPackage(
  ctx: SlotBuildContext,
): Promise<WeekSynthesisPackage> {
  if (ctx.scope !== "weekly") {
    throw new Error("week_synthesis package requires weekly scope");
  }
  const dates = isoWeekDates(ctx.period_key);
  const reader = new ViewStateReader({
    view_root: ctx.view_root,
    pi_base_url: ctx.pi_base_url,
  });
  const days: DayInWeek[] = [];
  const missing: string[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const weekday = WEEKDAYS[i];
    const view = await reader.read("daily", date);
    if (!view || view.scope !== "daily") {
      days.push({ date, weekday, has_synthesis: false, synthesis: null, day_score: null, day_score_band: null });
      missing.push(date);
      continue;
    }
    const entry = view.slots.day_synthesis;
    const fresh = entry?.status === "fresh" || entry?.status === "aging" || entry?.status === "stale";
    if (!fresh || !entry?.payload) {
      days.push({ date, weekday, has_synthesis: false, synthesis: null, day_score: null, day_score_band: null });
      missing.push(date);
      continue;
    }
    const payload = entry.payload as DaySynthesisPayload;
    const dayScoreKpi = payload.kpis?.find((k) => k.id === "day_score");
    days.push({
      date,
      weekday,
      has_synthesis: true,
      synthesis: payload,
      day_score: dayScoreKpi?.value ?? null,
      day_score_band: dayScoreKpi?.band ?? null,
    });
  }

  return {
    meta: {
      period_key: ctx.period_key,
      generated_at: ctx.now.toISOString(),
      tz: ctx.tz,
      package_version: "week-synthesis-package/v1",
    },
    tier1_snapshot: ctx.tier1,
    prior: {},
    domain: {
      days,
      missing_or_stale: missing,
    },
  };
}

export function weekSynthesisFactsHash(pkg: WeekSynthesisPackage): string {
  return shortHash({
    period_key: pkg.meta.period_key,
    days: pkg.domain.days.map((d) => ({ date: d.date, has: d.has_synthesis, score: d.day_score })),
  });
}

/** YYYY-Www → 7 YYYY-MM-DD dates (Mon..Sun). */
function isoWeekDates(weekKey: string): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) throw new Error(`Bad week_key: ${weekKey}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const mondayMs = jan4.getTime() - (jan4Dow - 1) * 86_400_000 + (week - 1) * 7 * 86_400_000;
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(mondayMs + i * 86_400_000);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return out;
}
