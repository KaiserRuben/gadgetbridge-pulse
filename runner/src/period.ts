/** Period keying. Wake-date local semantics. */

import { db } from "./db.ts";
import { config } from "./config.ts";
import { isV2Complete, isV3Complete } from "./state/completion-log.ts";

/**
 * Latest "day" tracked. Defined as the local date of the most recent
 * activity sample. Most data syncs follow a wake event so this is the
 * intuitive "today" for the user.
 */
export function latestSnapshotDate(): string {
  const r = db()
    .prepare<[], { ts: number }>(
      "SELECT MAX(TIMESTAMP) AS ts FROM HUAWEI_ACTIVITY_SAMPLE",
    )
    .get();
  if (!r?.ts) throw new Error("HUAWEI_ACTIVITY_SAMPLE empty — no snapshot date");
  const d = new Date(r.ts * 1000);
  return localDateKey(d);
}

/** YYYY-MM-DD in the configured timezone. */
export function localDateKey(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * True when `periodKey` is strictly before today's local date — i.e. the day
 * is finished and no more samples can land in it. The full LLM pipeline only
 * runs for completed days; mid-day stage 4/5 output is misleading because
 * steps/stress/HRV are still partial.
 */
export function isDayComplete(periodKey: string, now: Date = new Date()): boolean {
  return periodKey < localDateKey(now);
}

/** True when v2 stage 7 has recorded `v2_daily` in the completion log. */
export function isDailyFinalised(periodKey: string): boolean {
  return isV2Complete(periodKey);
}

/** True when all four v3 artifacts (sleep, recovery, activity, synthesis) are
 * recorded in the completion log for this day. */
export function isV3Finalised(periodKey: string): boolean {
  return isV3Complete(periodKey);
}

/** ISO week key e.g. 2026-W19 ending on the given date. */
export function isoWeekKey(d: Date): string {
  // Thursday-based ISO week per ISO-8601.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
