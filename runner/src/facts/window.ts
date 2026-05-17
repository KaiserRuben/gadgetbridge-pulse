/**
 * Day-window helper for the v2 facts pipeline.
 *
 * Wake-date semantics: a "day" runs from local 00:00 to next-day local 00:00
 * in the configured timezone (default Europe/Berlin). All windows are
 * half-open `[start, end)` so that consecutive days don't double-count the
 * 00:00 boundary minute.
 *
 * Returned numbers come in two units because the underlying GadgetBridge
 * tables disagree:
 *   - HUAWEI_ACTIVITY_SAMPLE / HUAWEI_STRESS_SAMPLE — TIMESTAMP in UNIX SECONDS
 *   - HUAWEI_SLEEP_STAGE_SAMPLE / HUAWEI_SLEEP_STATS_SAMPLE — TIMESTAMP in MS
 *
 * Stage-0 query modules pick the relevant unit; this helper supplies both
 * so the call sites stay tidy.
 */
import type { Ms, Sec } from "../../../lib/types/branded.ts";

// Local re-implementation of the brand helpers so the v2 facts pipeline
// stays free of cross-package runtime imports (tsx ESM loader struggles
// with .ts files from the root package which is CommonJS by default).
// These are identical no-op casts to the canonical helpers in
// `lib/types/branded.ts` — kept in lockstep deliberately.
const asMs = (n: number): Ms => n as Ms;
const asSec = (n: number): Sec => n as Sec;

export interface DayWindow {
  startSec: Sec;
  endSec: Sec;
  startMs: Ms;
  endMs: Ms;
  /** ISO date YYYY-MM-DD that defines this window's local-day key. */
  dateKey: string;
  /** IANA timezone used to resolve the local-day boundary. */
  tz: string;
}

/**
 * Build the half-open `[start, end)` window for the local date `periodKey`
 * in the given timezone.
 *
 * Timezone resolution uses a probe via `Intl.DateTimeFormat` so the helper
 * is DST-aware without external libraries.
 */
export function dayWindow(periodKey: string, timezone = "Europe/Berlin"): DayWindow {
  const startSec = localWallToUnixSec(periodKey, 0, 0, 0, timezone);
  const endSec = startSec + 24 * 3600;
  return {
    startSec: asSec(startSec),
    endSec: asSec(endSec),
    startMs: asMs(startSec * 1000),
    endMs: asMs(endSec * 1000),
    dateKey: periodKey,
    tz: timezone,
  };
}

/**
 * Convert a local wall-clock time (YYYY-MM-DD plus hour/minute/second
 * components) to a UNIX-seconds timestamp in the supplied timezone.
 *
 * Implementation: interpret the wall clock as if it were UTC, then probe
 * the timezone offset for that instant and subtract it. Handles spring/fall
 * DST transitions via Intl.
 */
function localWallToUnixSec(
  dateKey: string,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const naiveUtcMs = Date.UTC(y, m - 1, d, hour, minute, second);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(new Date(naiveUtcMs));
  const offsetStr = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = offsetStr.match(/GMT([+-]?\d+)(?::?(\d+))?/);
  const offHours = match ? parseInt(match[1], 10) : 0;
  const offMinutes =
    match && match[2] ? parseInt(match[2], 10) * (offHours < 0 ? -1 : 1) : 0;
  const offsetSec = offHours * 3600 + offMinutes * 60;
  return Math.floor(naiveUtcMs / 1000) - offsetSec;
}

/** YYYY-MM-DD key for the local date `daysBack` days before `periodKey`. */
export function shiftDateKey(periodKey: string, daysBack: number): string {
  const [y, m, d] = periodKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
