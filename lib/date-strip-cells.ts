import "server-only";
import { addDays } from "@/lib/time";
import { loadDaily } from "@/lib/insights";
import { todayKey } from "@/lib/time";
import type { DailyInsightV2 } from "@/lib/types/generated";

export type DateStripCell = {
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  /**
   * Verdict band for that day, mirrored from `daily.json`. `null` indicates
   * either no data or an abstain payload — the strip renders a muted dot.
   */
  verdict_band: DailyInsightV2["verdict_band"];
};

/**
 * Build a `n`-day window centered (or biased forward) on `activeDate`. Right
 * edge is capped at today so the strip never shows future cells. When the
 * active date is recent, the strip behaves like a trailing-14d view (today on
 * the right). When the active date is older, the window opens forward — up to
 * `forwardBuffer` cells ahead — so the user can step day-by-day back toward
 * today without needing the calendar drawer.
 *
 * Order: oldest → newest. Active date is included.
 *
 * Examples (n=14, forwardBuffer=6, today=2026-05-08):
 *   activeDate=2026-05-08 → 2026-04-25 … 2026-05-08 (active at right)
 *   activeDate=2026-05-04 → 2026-04-25 … 2026-05-08 (active 4 from right)
 *   activeDate=2026-04-28 → 2026-04-21 … 2026-05-04 (active 7 from right;
 *                                                     6 future cells leading
 *                                                     toward today)
 */
export async function getDateStripCells(
  activeDate: string,
  n = 14,
  forwardBuffer = 6,
): Promise<DateStripCell[]> {
  const today = todayKey();
  // Cap the right edge: prefer activeDate + forwardBuffer, but never past today.
  const desiredRight = addDays(activeDate, forwardBuffer);
  const right = desiredRight > today ? today : desiredRight;

  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    dates.push(addDays(right, -i));
  }
  // Read in parallel; loadDaily is filesystem-cheap and tolerant of misses.
  const dailies = await Promise.all(dates.map((d) => loadDaily(d)));
  return dates.map((date, i) => {
    const daily = dailies[i];
    const band = daily && !daily.abstain ? daily.verdict_band : null;
    return { date, verdict_band: band };
  });
}
