/**
 * Midday-check packager.
 *
 * Reads morning_briefing (prior) + tier1.kpis_today (current mid-day state).
 * Reads HUAWEI_STRESS_SAMPLE directly to package a 24-hour stress profile
 * for the drill chart (telemetry-only — kept under `_drill_telemetry` so
 * the grounding validator ignores it).
 */

import type Database from "better-sqlite3";

import { dayWindow } from "../../../facts/window.ts";
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
  /** Drill-only telemetry. See evening-review/package.ts for the rationale. */
  _drill_telemetry: {
    /** 24 entries (hours 0..23); `null` for hours with no stress samples. */
    stress_hourly: (number | null)[];
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

  const win = dayWindow(ctx.period_key, ctx.tz);
  const stressHourly = readStressHourly(
    ctx.db,
    win.startMs as number,
    win.endMs as number,
    ctx.tz,
  );

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
      _drill_telemetry: {
        stress_hourly: stressHourly,
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

/**
 * Hour-bucketed stress means (24 entries). HUAWEI_STRESS_SAMPLE.TIMESTAMP
 * is in UNIX milliseconds; STRESS is 0..99. Returns `null` for hours with
 * zero samples so the drill chart can render a gap.
 */
function readStressHourly(
  db: Database.Database,
  startMs: number,
  endMs: number,
  tz: string,
): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(24).fill(null);
  let rows: Array<{ TIMESTAMP: number; STRESS: number }> = [];
  try {
    rows = db
      .prepare<[number, number], { TIMESTAMP: number; STRESS: number }>(
        `SELECT TIMESTAMP, STRESS
         FROM HUAWEI_STRESS_SAMPLE
         WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
           AND STRESS BETWEEN 0 AND 99
         ORDER BY TIMESTAMP ASC`,
      )
      .all(startMs, endMs);
  } catch {
    return out;
  }
  if (rows.length === 0) return out;
  const sum = new Array<number>(24).fill(0);
  const count = new Array<number>(24).fill(0);
  for (const r of rows) {
    const h = localHourOf(r.TIMESTAMP, tz);
    if (h < 0 || h > 23) continue;
    sum[h] += r.STRESS;
    count[h] += 1;
  }
  for (let h = 0; h < 24; h++) {
    if (count[h] > 0) out[h] = Math.round((sum[h] / count[h]) * 10) / 10;
  }
  return out;
}

function localHourOf(tsMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(tsMs));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}
