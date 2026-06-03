/**
 * Evening-review packager.
 *
 * Reads midday_check (prior) + tier1.kpis_today (full day signals) +
 * workouts list. Also reads HUAWEI_ACTIVITY_SAMPLE directly to package a
 * 5-min HR series + zone breakdown for the drill chart (telemetry-only;
 * not exposed to the LLM prompt — see `_drill_telemetry`).
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
import type { MiddayCheckPayload } from "../midday-check/types.ts";
import type { KpiWorkout } from "../../types.ts";
import type {
  EveningHrBucket,
  EveningHrZoneMinute,
} from "./types.ts";

/** HR zones — kept in sync with `lib/constants.ts → HR_ZONES`. */
const HR_ZONES: ReadonlyArray<{ min: number; max: number; label: string }> = [
  { min: 0, max: 90, label: "Rest" },
  { min: 90, max: 110, label: "Easy" },
  { min: 110, max: 130, label: "Aerobic" },
  { min: 130, max: 150, label: "Threshold" },
  { min: 150, max: 220, label: "Max" },
];

const BUCKET_MS = 5 * 60 * 1000;

export interface EveningDomain {
  evening_window: {
    generated_at_iso: string;
    local_hour: number;
    minutes_until_typical_bedtime: number | null;
  };
  /** Pulled from tier1.kpis_today.workouts — surfaced explicitly for prose convenience. */
  workouts_today: KpiWorkout[];
  /**
   * Drill-only telemetry. Kept under a `_drill_telemetry` key so the
   * grounding validator (which scans the package for numbers cited in
   * prose) can ignore it — every value here is for chart rendering, not
   * for the LLM to quote.
   */
  _drill_telemetry: {
    hr_today: EveningHrBucket[];
    hr_zone_minutes: EveningHrZoneMinute[];
  };
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

  const win = dayWindow(ctx.period_key, ctx.tz);
  const nowMs = ctx.now.getTime();
  const endMs = Math.min(nowMs, win.endMs as number);
  const { hr_today, hr_zone_minutes } = readHrToday(
    ctx.db,
    win.startMs as number,
    endMs,
    ctx.tz,
  );

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
      _drill_telemetry: {
        hr_today,
        hr_zone_minutes,
      },
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

/**
 * Read 5-min HR buckets between [startMs, endMs) and aggregate minutes per
 * zone. HUAWEI_ACTIVITY_SAMPLE.TIMESTAMP is in UNIX seconds.
 *
 * Signed-byte overflow: HR sometimes arrives as a negative byte. Real value
 * is `256 + raw` when raw < 0 and raw !== -1 (the no-measurement sentinel).
 */
function readHrToday(
  db: Database.Database,
  startMs: number,
  endMs: number,
  tz: string,
): { hr_today: EveningHrBucket[]; hr_zone_minutes: EveningHrZoneMinute[] } {
  if (endMs <= startMs) {
    return {
      hr_today: [],
      hr_zone_minutes: HR_ZONES.map((z) => ({ label: z.label, minutes: 0 })),
    };
  }
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  let rows: Array<{ TIMESTAMP: number; HEART_RATE: number | null }> = [];
  try {
    rows = db
      .prepare<
        [number, number],
        { TIMESTAMP: number; HEART_RATE: number | null }
      >(
        `SELECT TIMESTAMP, HEART_RATE
         FROM HUAWEI_ACTIVITY_SAMPLE
         WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
           AND OTHER_TIMESTAMP > TIMESTAMP
         ORDER BY TIMESTAMP ASC`,
      )
      .all(startSec, endSec);
  } catch {
    return {
      hr_today: [],
      hr_zone_minutes: HR_ZONES.map((z) => ({ label: z.label, minutes: 0 })),
    };
  }

  const buckets = new Map<number, number[]>();
  const zoneCounts = HR_ZONES.map(() => 0);

  for (const r of rows) {
    const raw = r.HEART_RATE;
    if (raw == null || raw === -1) continue;
    const bpm = raw < 0 ? 256 + raw : raw;
    if (bpm < 31 || bpm > 219) continue;
    const tsMs = r.TIMESTAMP * 1000;
    const bucketStart = Math.floor(tsMs / BUCKET_MS) * BUCKET_MS;
    const arr = buckets.get(bucketStart);
    if (arr) arr.push(bpm);
    else buckets.set(bucketStart, [bpm]);
    const zoneIdx = HR_ZONES.findIndex((z) => bpm >= z.min && bpm < z.max);
    if (zoneIdx >= 0) zoneCounts[zoneIdx] += 1;
  }

  const hr_today: EveningHrBucket[] = [];
  for (const [ts, vals] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    hr_today.push({ ts_iso: msIso(ts, tz), bpm_mean: Math.round(m) });
  }
  const hr_zone_minutes: EveningHrZoneMinute[] = HR_ZONES.map((z, i) => ({
    label: z.label,
    minutes: zoneCounts[i],
  }));
  return { hr_today, hr_zone_minutes };
}

/** Format `ms` as a local-tz ISO string with offset. */
function msIso(ms: number, tz: string): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const yyyy = get("year");
  const mo = get("month");
  const dd = get("day");
  let hh = get("hour");
  if (hh === "24") hh = "00";
  const mi = get("minute");
  const ss = get("second");
  const utcMs = Date.UTC(
    Number(yyyy),
    Number(mo) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss),
  );
  const offsetMin = Math.round((utcMs - d.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${yyyy}-${mo}-${dd}T${hh}:${mi}:${ss}${sign}${oh}:${om}`;
}
