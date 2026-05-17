import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";
import { addDays } from "@/lib/time";
import {
  EXTRACTORS,
  findExploreMetric,
  type ExploreMetricId,
} from "@/lib/explore-metrics-defs";
import type {
  DistributionBin,
  MetricDetail,
  SampleRow,
  WeekOverlayDay,
} from "@/lib/explore-metric-detail-types";
import type { FactsBundleV2 } from "@/lib/types/generated";

// Re-export client-safe types so server callers can import from a single
// place. The runtime helpers live in `-types.ts` because client components
// may need them too — see the note at the top of that file.
export type {
  DistributionBin,
  MetricDetail,
  SampleRow,
  WeekOverlayDay,
} from "@/lib/explore-metric-detail-types";
export { findBinIndex } from "@/lib/explore-metric-detail-types";

/**
 * Server-side data layer for `/explore/[metric]` deep-dive panels.
 *
 * Builds a single `MetricDetail` payload that feeds all four panels:
 *   1. timeline_30d  (line + 14d-mean ± std band)
 *   2. distribution_30d (histogram, 5 bins)
 *   3. week_overlay (7-day overlay, day-of-week comparison)
 *   4. samples (raw HRV/HR samples for the anchor date if present)
 *
 * Reads `_facts.json` files from `insights/daily/<date>/_facts.json`. Missing
 * files / extractor returning null degrade gracefully — every consumer panel
 * has its own empty-state. v2.1 fields (`hrv_series`, `breath_rate_mean`,
 * etc.) are optional; days produced before the v2.1 backfill ran simply
 * yield `null` slots.
 */

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT =
  process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

async function readFacts(
  date: string,
): Promise<FactsBundleV2 | null> {
  const p = path.join(INSIGHTS_ROOT, "daily", date, "_facts.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
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
 * 5-bin equal-width histogram over the non-null values. Returns [] when
 * there are zero numeric samples so the panel can render its empty state.
 * Single-value windows degrade to one bin around the value.
 */
function buildHistogram(values: number[]): DistributionBin[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) {
    return [
      {
        bucket: lo.toFixed(2),
        count: values.length,
        range: [lo, hi],
      },
    ];
  }
  const BIN_COUNT = 5;
  const width = (hi - lo) / BIN_COUNT;
  const bins: DistributionBin[] = Array.from({ length: BIN_COUNT }, (_, i) => {
    const a = lo + i * width;
    const b = i === BIN_COUNT - 1 ? hi : lo + (i + 1) * width;
    return {
      bucket: `${a.toFixed(1)}–${b.toFixed(1)}`,
      count: 0,
      range: [a, b] as [number, number],
    };
  });
  for (const v of values) {
    let idx = Math.floor((v - lo) / width);
    if (idx >= BIN_COUNT) idx = BIN_COUNT - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  return bins;
}

/**
 * Build the `MetricDetail` payload for a metric anchored to `date`.
 *
 * Strategy: load the trailing 30-day window of `_facts.json` once and reuse
 * the buffer for the timeline, histogram, week overlay, and (for hrv) the
 * sample browser. At most 30 file reads regardless of which metric.
 */
export async function getMetricDetail(
  metric: ExploreMetricId,
  date: string,
): Promise<MetricDetail> {
  noStore();
  const def = findExploreMetric(metric);
  if (!def) {
    return {
      metric,
      date,
      timeline_30d: [],
      timeline_baseline: { mean: null, std: null, n: 0 },
      distribution_30d: [],
      week_overlay: [],
      samples: null,
    };
  }
  const extract = EXTRACTORS[metric];

  // Build 30-day window ending at `date`, oldest → newest.
  const dates: string[] = [];
  for (let i = 29; i >= 0; i--) dates.push(addDays(date, -i));

  const window = await Promise.all(
    dates.map(async (d) => ({ date: d, facts: await readFacts(d) })),
  );

  const timeline_30d = window.map((d) => ({
    date: d.date,
    value: d.facts ? extract(d.facts) : null,
  }));

  const numeric30 = timeline_30d
    .map((p) => p.value)
    .filter((v): v is number => v !== null);

  const last14 = timeline_30d.slice(-14);
  const numeric14 = last14
    .map((p) => p.value)
    .filter((v): v is number => v !== null);

  const baselineMean = mean(numeric14);
  // § 7 degrade: don't publish a stddev band on n<7 — it's noisy.
  const baselineStd =
    numeric14.length >= 7 && baselineMean !== null
      ? stddev(numeric14, baselineMean)
      : null;

  const distribution_30d = buildHistogram(numeric30);

  // Week overlay: last 7 calendar days, oldest → newest. Each day's inner
  // series is a single point for daily-aggregate metrics; HRV gets the raw
  // intra-day samples projected onto a 0..1 normalised x axis so the lines
  // stack cleanly.
  const last7 = window.slice(-7);
  const week_overlay: WeekOverlayDay[] = last7.map((d) => {
    if (!d.facts) return { date: d.date, series: [] };
    if (metric === "hrv_rmssd") {
      const hrv = d.facts.cardio.hrv_series;
      if (Array.isArray(hrv) && hrv.length > 0) {
        const tsList = hrv
          .map((s) => Date.parse(s.ts_iso))
          .filter((t) => Number.isFinite(t));
        if (tsList.length === 0) {
          return { date: d.date, series: [] };
        }
        const t0 = Math.min(...tsList);
        const t1 = Math.max(...tsList);
        const span = Math.max(1, t1 - t0);
        return {
          date: d.date,
          series: hrv
            .map((s) => {
              const t = Date.parse(s.ts_iso);
              if (!Number.isFinite(t)) return null;
              return {
                x: Math.round(((t - t0) / span) * 100),
                value: typeof s.value_ms === "number" ? s.value_ms : null,
              };
            })
            .filter((p): p is { x: number; value: number | null } => p !== null),
        };
      }
    }
    const v = extract(d.facts);
    return {
      date: d.date,
      series: v === null ? [] : [{ x: 0, value: v }],
    };
  });

  // Samples: only for HRV (intra-day series available in facts). Other
  // metrics return null → the panel renders the daily-aggregate empty state.
  let samples: SampleRow[] | null = null;
  if (metric === "hrv_rmssd") {
    const anchorFacts = window[window.length - 1]?.facts;
    const hrv = anchorFacts?.cardio.hrv_series;
    if (Array.isArray(hrv) && hrv.length > 0) {
      // Cap at 200 to keep the v1 list cheap; FLIP-expand stays smooth.
      samples = hrv.slice(0, 200).map((s) => ({
        ts_iso: s.ts_iso,
        value: s.value_ms,
      }));
    } else {
      samples = [];
    }
  }

  return {
    metric,
    date,
    timeline_30d,
    timeline_baseline: {
      mean: baselineMean,
      std: baselineStd,
      n: numeric14.length,
    },
    distribution_30d,
    week_overlay,
    samples,
  };
}
