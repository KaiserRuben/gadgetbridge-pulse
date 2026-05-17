/**
 * Client-safe types and pure helpers for the `/explore/[metric]` deep-dive
 * panels. Split from `lib/explore-metric-detail.ts` because that file is
 * marked `server-only` (it reads `_facts.json` from disk) — anything a
 * client component needs lives here so the RSC → Client boundary stays
 * clean.
 */

import type { ExploreMetricId } from "@/lib/explore-metrics-defs";

export type DistributionBin = {
  bucket: string;
  count: number;
  range: [number, number];
};

export type WeekOverlayDay = {
  date: string;
  series: Array<{ x: number | string; value: number | null }>;
};

export type SampleRow = {
  ts_iso: string;
  value: number;
  context?: string;
};

export interface MetricDetail {
  metric: ExploreMetricId;
  date: string;
  timeline_30d: Array<{ date: string; value: number | null }>;
  timeline_baseline: { mean: number | null; std: number | null; n: number };
  distribution_30d: DistributionBin[];
  week_overlay: WeekOverlayDay[];
  samples: SampleRow[] | null;
}

/**
 * Index of the histogram bin containing `value`, or -1 if out of range or
 * the histogram is empty. The last bin is inclusive on both ends; the
 * others are half-open `[a, b)` to avoid double-counting.
 */
export function findBinIndex(
  bins: DistributionBin[],
  value: number,
): number {
  if (bins.length === 0) return -1;
  for (let i = 0; i < bins.length; i++) {
    const [a, b] = bins[i].range;
    if (i === bins.length - 1) {
      if (value >= a && value <= b) return i;
    } else if (value >= a && value < b) {
      return i;
    }
  }
  return -1;
}
