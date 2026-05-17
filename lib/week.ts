/**
 * ISO week helpers. weekKey format: `YYYY-Www` (e.g. "2026-W19").
 * All dates are computed in UTC; the runner emits week boundaries on
 * Mon 00:00 Europe/Berlin which aligns with ISO weeks.
 */

const WEEK_RE = /^(\d{4})-W(\d{2})$/;

export function parseWeekKey(key: string): { year: number; week: number } | null {
  const m = WEEK_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
  if (week < 1 || week > 53) return null;
  return { year, week };
}

export function isWeekKey(key: string): boolean {
  return parseWeekKey(key) !== null;
}

/** Monday (00:00 UTC) of the given ISO week. */
export function isoWeekStart(year: number, week: number): Date {
  // Jan 4 is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // Mon=1..Sun=7
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}

/** ISO date string (YYYY-MM-DD) for the n-th day (0..6) within the week. */
export function weekDayDate(weekKey: string, dayIdx: number): string | null {
  const parsed = parseWeekKey(weekKey);
  if (!parsed) return null;
  const monday = isoWeekStart(parsed.year, parsed.week);
  monday.setUTCDate(monday.getUTCDate() + dayIdx);
  return monday.toISOString().slice(0, 10);
}

export function weekDateRange(weekKey: string): { from: string; to: string } | null {
  const parsed = parseWeekKey(weekKey);
  if (!parsed) return null;
  const monday = isoWeekStart(parsed.year, parsed.week);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

export function shiftWeek(weekKey: string, delta: number): string | null {
  const parsed = parseWeekKey(weekKey);
  if (!parsed) return null;
  const monday = isoWeekStart(parsed.year, parsed.week);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  // Recompute ISO-week from the new Monday.
  return dateToWeekKey(monday.toISOString().slice(0, 10));
}

/**
 * ISO 8601 week number. Algorithm: shift `date` to the Thursday of its week,
 * then count weeks since the Thursday of week 1 (which is by definition the
 * Thursday closest to Jan 4 of the ISO year). Avoids the off-by-one trap of
 * the "days since Jan 1 / 7" formula that breaks at Dec-Jan boundaries.
 */
export function dateToWeekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayOfWeek + 3);
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const ftDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDow + 3);
  const weekNum = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

export function fmtWeekRange(weekKey: string): string {
  const r = weekDateRange(weekKey);
  if (!r) return weekKey;
  const [, fm, fd] = r.from.split("-");
  const [, tm, td] = r.to.split("-");
  if (fm === tm) return `${Number(fd)}.–${Number(td)}. ${monthDe(Number(fm))}`;
  return `${Number(fd)}. ${monthDe(Number(fm))} – ${Number(td)}. ${monthDe(Number(tm))}`;
}

function monthDe(m: number): string {
  return ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][m - 1] ?? "";
}
