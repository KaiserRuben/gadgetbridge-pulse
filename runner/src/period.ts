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

/**
 * Map a YYYY-MM-DD wake-date to the ISO week key it belongs to. Cluster
 * dependency declarations use this to fan a `day_end` event out to the
 * containing weekly cell.
 *
 * Equivalent to `weekKeyFromDate` in `stageW-weekly.ts` but kept here so the
 * helper is reachable from any caller without the heavy stage import. The
 * stage module re-exports its own version for backwards compatibility.
 */
export function weekKeyForDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return isoWeekKey(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * 7 YYYY-MM-DD dates in `weekKey`, Monday → Sunday. Throws on a malformed
 * key so callers don't silently feed an empty array into a 7-day window.
 */
export function datesInWeek(weekKey: string): string[] {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) throw new Error(`datesInWeek: bad weekKey ${weekKey}`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  // ISO week 1 = the week containing Jan 4th. Mon of that week is the
  // anchor; we then shift by (week - 1) * 7 days.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(week1Mon);
    d.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7 + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
