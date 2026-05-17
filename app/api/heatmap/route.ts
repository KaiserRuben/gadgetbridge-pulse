import { NextResponse } from "next/server";
import {
  getExploreMetricYear,
  isExploreMetricId,
} from "@/lib/explore-metrics";

/**
 * Heatmap data feeder.
 *
 * Returns one year of `[{date, value}]` pairs for a single metric, used by
 * the client switcher in `<HeatmapMetricSwitcher>` and `/explore/heatmap`.
 *
 * Query params:
 *   - `metric`: required, must be one of `EXPLORE_METRIC_IDS` (12 ids).
 *   - `year`:   optional 4-digit year. Defaults to current year.
 *
 * Cache horizon: `revalidate: 3600` per v2.1 § 10. Daily wearable data
 * changes at most once per pipeline run; an hourly stale-while-revalidate
 * is plenty for a year-scale chart.
 */
export const revalidate = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const metric = url.searchParams.get("metric");
  const yearParam = url.searchParams.get("year");

  if (!metric || !isExploreMetricId(metric)) {
    return NextResponse.json(
      { ok: false, error: "invalid_metric" },
      { status: 400 },
    );
  }

  const now = new Date();
  const year =
    yearParam && /^\d{4}$/.test(yearParam)
      ? Number(yearParam)
      : now.getUTCFullYear();

  const data = await getExploreMetricYear(metric, year);
  if (data === null) {
    return NextResponse.json(
      { ok: false, error: "read_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, metric, year, data });
}
