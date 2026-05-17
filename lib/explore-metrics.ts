import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";
import { addDays } from "@/lib/time";
import {
  EXPLORE_METRICS,
  EXTRACTORS,
  findExploreMetric,
  type ExploreMetricDef,
  type ExploreMetricId,
} from "@/lib/explore-metrics-defs";
import type { FactsBundleV2 } from "@/lib/types/generated";

/**
 * Server-side data layer for the Explore route.
 *
 * The metric registry (ids, labels, decimals, accent vars) lives in
 * `lib/explore-metrics-defs.ts` so client components can render labels
 * without dragging `server-only` and `node:fs` into their bundle. This
 * file owns the heavy lifting: reading `_facts.json` files, projecting
 * them through `EXTRACTORS`, and computing the rolling stats consumed
 * by the KPI tiles + heatmap.
 */

// Re-export the client-safe types so consumer code only needs one import
// when it wants both the registry and the snapshot type.
export type {
  ExploreDomain,
  ExploreMetricDef,
  ExploreMetricId,
} from "@/lib/explore-metrics-defs";
export {
  EXPLORE_METRICS,
  EXPLORE_METRIC_IDS,
  findExploreMetric,
  isExploreMetricId,
} from "@/lib/explore-metrics-defs";

/**
 * Server-computed snapshot returned to client components. Plain JSON only —
 * no functions or non-serialisable types — so it can cross the RSC
 * boundary without the "functions cannot be passed" error.
 */
export type ExploreMetric = {
  def: ExploreMetricDef;
  /** Latest non-null value within the window, or `null` if the window is empty. */
  today: number | null;
  /** ISO date `YYYY-MM-DD` of the value used for `today`. */
  todayDate: string | null;
  /** 14-day mean (skipping `null`s); `null` if `< 1` sample. */
  mean14d: number | null;
  /** 14-day population stddev; `null` if `< 7` samples per § 7 degrade rule. */
  std14d: number | null;
  /** z-score relative to (mean14d, std14d). `null` when std is unavailable. */
  zScore: number | null;
  /** Percentile rank of `today` within the trailing 30-day distribution (0..100). */
  percentile30d: number | null;
  /** Trailing-14-day series, oldest → newest, with `null` gaps preserved. */
  series14d: Array<{ date: string; value: number | null }>;
  /** Number of non-null samples in the 30-day window. */
  n30d: number;
};

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT =
  process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

/**
 * Read up to N days of `_facts.json` ending on `latestDate` (inclusive).
 * Missing files / parse failures resolve to `null` so the caller can skip
 * gaps without throwing.
 */
async function loadFactsWindow(
  latestDate: string,
  days: number,
): Promise<Array<{ date: string; facts: FactsBundleV2 | null }>> {
  noStore();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(addDays(latestDate, -i));

  return Promise.all(
    dates.map(async (d) => {
      const p = path.join(INSIGHTS_ROOT, "daily", d, "_facts.json");
      try {
        const txt = await readFile(p, "utf8");
        return { date: d, facts: JSON.parse(txt) as FactsBundleV2 };
      } catch {
        return { date: d, facts: null };
      }
    }),
  );
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[], mu: number): number | null {
  if (values.length < 2) return null;
  const variance =
    values.reduce((s, v) => s + (v - mu) * (v - mu), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Percentile rank of `value` within `pool` using the standard
 * "fraction of pool ≤ value" definition. Returns 0..100.
 */
function percentileRank(pool: number[], value: number): number {
  if (pool.length === 0) return 0;
  let leq = 0;
  for (const v of pool) if (v <= value) leq += 1;
  return Math.round((leq / pool.length) * 100);
}

/**
 * Build the 12-metric snapshot ending on `latestDate`. Loads up to 30 days
 * of `_facts.json` once and reuses the buffer across all metrics so we do
 * at most 30 file reads regardless of metric count.
 */
export async function getExploreMetrics(
  latestDate: string,
): Promise<ExploreMetric[]> {
  const window = await loadFactsWindow(latestDate, 30);
  const last14 = window.slice(window.length - 14);

  return EXPLORE_METRICS.map((def) => {
    const extract = EXTRACTORS[def.id];
    const series30 = window.map((d) => ({
      date: d.date,
      value: d.facts ? extract(d.facts) : null,
    }));
    const series14 = last14.map((d) => ({
      date: d.date,
      value: d.facts ? extract(d.facts) : null,
    }));

    const numeric30 = series30
      .map((p) => p.value)
      .filter((v): v is number => v !== null);
    const numeric14 = series14
      .map((p) => p.value)
      .filter((v): v is number => v !== null);

    let today: number | null = null;
    let todayDate: string | null = null;
    for (let i = series30.length - 1; i >= 0; i--) {
      if (series30[i].value !== null) {
        today = series30[i].value;
        todayDate = series30[i].date;
        break;
      }
    }

    const mu = mean(numeric14);
    // § 7 degrade rule: require n ≥ 7 before publishing a stddev/z-score so
    // a sparse first-week run doesn't render screaming +6σ chips.
    const sd =
      numeric14.length >= 7 && mu !== null ? stddev(numeric14, mu) : null;
    const z =
      today !== null && mu !== null && sd !== null && sd > 0
        ? (today - mu) / sd
        : null;
    const pct =
      today !== null && numeric30.length >= 1
        ? percentileRank(numeric30, today)
        : null;

    return {
      def,
      today,
      todayDate,
      mean14d: mu,
      std14d: sd,
      zScore: z,
      percentile30d: pct,
      series14d: series14,
      n30d: numeric30.length,
    } satisfies ExploreMetric;
  });
}

/**
 * Single-metric year extractor for the heatmap route handler. Reads every
 * `_facts.json` whose date prefix matches `year` and projects to
 * `[{ date, value }]` pairs sorted ascending. Missing files are skipped.
 */
export async function getExploreMetricYear(
  metricId: ExploreMetricId,
  year: number,
): Promise<Array<{ date: string; value: number | null }> | null> {
  noStore();
  const def = findExploreMetric(metricId);
  if (!def) return null;
  const extract = EXTRACTORS[def.id];

  const dailyRoot = path.join(INSIGHTS_ROOT, "daily");
  const yearPrefix = `${year}-`;

  const { readdir } = await import("node:fs/promises");
  let folders: string[];
  try {
    folders = await readdir(dailyRoot);
  } catch {
    return null;
  }

  const candidates = folders
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && f.startsWith(yearPrefix))
    .sort();

  return Promise.all(
    candidates.map(async (date) => {
      const p = path.join(dailyRoot, date, "_facts.json");
      try {
        const txt = await readFile(p, "utf8");
        const facts = JSON.parse(txt) as FactsBundleV2;
        return { date, value: extract(facts) };
      } catch {
        return { date, value: null };
      }
    }),
  );
}
