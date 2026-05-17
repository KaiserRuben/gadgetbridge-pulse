/**
 * Time-window helpers. Pure functions, all timezone-aware.
 *
 * Wake-date semantics: a "day" runs from local 00:00 to next local 00:00 in
 * Europe/Berlin. Sleep blocks belong to the day they ended on (matches the
 * user's mental model of "last night").
 */

const TZ = "Europe/Berlin";

/** Current local-date key (YYYY-MM-DD) right now. */
export function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Local-date key (YYYY-MM-DD) for a given unix-seconds timestamp. */
export function localDateKey(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

/**
 * Convert "YYYY-MM-DD HH:mm:ss" Berlin local wall-time to a unix-seconds
 * timestamp. Handles DST via Intl.
 */
function localWallToUnixSec(dateKey: string, hour = 0, minute = 0, second = 0): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Naïve UTC interpretation — same wall clock numbers, but as UTC
  const naiveUtcMs = Date.UTC(y, m - 1, d, hour, minute, second);
  // Find Berlin's offset for that instant; the actual unix time is naive - offset.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(new Date(naiveUtcMs));
  const offsetStr = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = offsetStr.match(/GMT([+-]?\d+)(?::?(\d+))?/);
  const offHours = match ? parseInt(match[1], 10) : 0;
  const offMinutes = match && match[2] ? parseInt(match[2], 10) * (offHours < 0 ? -1 : 1) : 0;
  const offsetMs = (offHours * 3600 + offMinutes * 60) * 1000;
  return Math.floor((naiveUtcMs - offsetMs) / 1000);
}

/** Window covering the local date in unix seconds: [start, end). */
export function windowForDate(dateKey: string): { since: number; until: number } {
  return {
    since: localWallToUnixSec(dateKey, 0, 0, 0),
    until: localWallToUnixSec(dateKey, 23, 59, 59) + 1,
  };
}

/** Window for a wake-date: previous-day 18:00 → this-day 12:00. */
export function sleepWindowForDate(dateKey: string): { since: number; until: number } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d));
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
  return {
    since: localWallToUnixSec(prevKey, 18, 0),
    until: localWallToUnixSec(dateKey, 12, 0),
  };
}

/** Add days to a YYYY-MM-DD key (negative = past). */
export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** ISO week key (YYYY-Www) ending on the given date. */
export function isoWeekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** First day (Monday) of the ISO week containing dateKey. */
export function isoWeekStart(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Mon=0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** YYYY-MM month key. */
export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** YYYY year key. */
export function yearKey(dateKey: string): string {
  return dateKey.slice(0, 4);
}

/** True when dateKey equals current local date. */
export function isToday(dateKey: string): boolean {
  return dateKey === todayKey();
}

/** True when dateKey is strictly before today (a completed day). */
export function isPast(dateKey: string): boolean {
  return dateKey < todayKey();
}

/** True when dateKey is strictly after today (future). */
export function isFuture(dateKey: string): boolean {
  return dateKey > todayKey();
}

/** Range of date keys (inclusive). */
export function dateRange(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let cur = startKey;
  while (cur <= endKey) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
