/**
 * Formatters for v3 metric display.
 *
 * Translates MetricDelta + BaselineStat into human-readable strings for
 * tile hints, drill-down callouts, and inline annotations.
 *
 * Convention: value + context. Never bare numbers.
 */

import type { MetricDelta, BaselineStat } from "@/lib/types/v3";

/**
 * Build the "norm X-Y" hint string that sits next to the value on a metric tile.
 * Uses median ± MAD as the normal range. Returns empty string if no baseline.
 */
export function formatBaselineHint(b: BaselineStat | null | undefined): string {
  if (!b || b.median == null || b.mad == null) return "";
  const lo = Math.round(b.median - b.mad);
  const hi = Math.round(b.median + b.mad);
  return `norm ${lo}–${hi}`;
}

/**
 * Build a delta chip string. Examples: "−4 vs Median", "+18% vs Schnitt", "im Normbereich".
 */
export function formatDeltaText(d: MetricDelta | null | undefined): string {
  if (!d || d.value == null) return "";
  if (d.band === "no_baseline") return "";
  if (d.band === "within") return "im Normbereich";
  if (d.delta_pct != null && Math.abs(d.delta_pct) >= 5) {
    const sign = d.delta_pct > 0 ? "+" : "−";
    return `${sign}${Math.abs(Math.round(d.delta_pct))}% vs Median`;
  }
  if (d.delta_abs != null) {
    const sign = d.delta_abs > 0 ? "+" : "−";
    return `${sign}${Math.abs(Math.round(d.delta_abs))} vs Median`;
  }
  return "";
}

/**
 * Build the "z=-2.7 deutlich unter" descriptor used in drill-down pages.
 */
export function formatZDescriptor(d: MetricDelta | null | undefined): string {
  if (!d || d.z_score == null) return "";
  const z = d.z_score;
  const abs = Math.abs(z);
  const word =
    abs >= 2 ? "deutlich" : abs >= 1 ? "klar" : "leicht";
  const direction = z > 0 ? "über" : z < 0 ? "unter" : "auf";
  return `z=${z.toFixed(1)} ${word} ${direction} Baseline`;
}

/** Sign-aware delta value for the existing DeltaChip component. */
export function deltaForChip(d: MetricDelta | null | undefined): { value: number; suffix?: string } | null {
  if (!d || d.delta_abs == null) return null;
  return { value: Math.round(d.delta_abs * 10) / 10 };
}

/** Map MetricDelta band to UI band token. */
export function bandFromDelta(d: MetricDelta | null | undefined): "above_usual" | "steady" | "below_usual" | null {
  if (!d || d.band === "no_baseline") return null;
  if (d.band === "within") return "steady";
  // band "high" or "medium" — sign of z determines direction.
  if (d.z_score == null) return "steady";
  return d.z_score > 0 ? "above_usual" : "below_usual";
}
