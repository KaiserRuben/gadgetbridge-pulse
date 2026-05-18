/**
 * Shim a `MorningLeverCard` (from the morning_insight cluster) into the
 * `SleepInsightV3` contract that `<InsightSection>` expects. Used by the
 * heart and stress pages, which have no dedicated `*_insight` cluster of
 * their own and reuse the morning-briefing levers as a coach surface.
 *
 * Two sanitization passes:
 *
 *   - `humanizeLeverId(id)` maps engineering names (`rhr_drift`) to German
 *     user-facing labels. Falls back to a generic underscore-to-spaces
 *     transform for IDs not in the table.
 *
 *   - `sanitizeLeverProse(text)` strips `field_name: value` lines from
 *     trajectory / projection strings. The morning prompt occasionally
 *     emits `trend_direction: flat` as if it were prose; without this
 *     filter the insight section renders it verbatim.
 *
 * Both helpers are exported so the (very small) heart/stress test
 * surface can exercise them independently.
 */

import type { MorningLeverCard } from "@/lib/v3-loaders";
import type { SleepInsightV3 } from "@/lib/types/v3";

const LEVER_LABELS: Record<string, string> = {
  rhr_drift: "Ruhepuls-Drift",
  rhr_drift_management: "Ruhepuls-Drift im Griff",
  hrv_low: "HRV niedrig",
  hrv_recovery: "HRV-Erholung",
  spo2_low: "SpO₂ niedrig",
  cardio_load: "Kardio-Last",
  stress_high: "Hochstress",
  stress_recovery: "Stress-Erholung",
  stress_management: "Stress-Management",
  sleep_debt: "Schlafdefizit",
  sleep_consistency: "Schlafrhythmus",
};

export function humanizeLeverId(id: string): string {
  if (LEVER_LABELS[id]) return LEVER_LABELS[id];
  return id
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function sanitizeLeverProse(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => !/^[a-z][a-z0-9_]*\s*:\s*\S+$/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // 4-word minimum so a degenerate one-word residue ("flat.") doesn't
  // sneak through as "prose".
  return cleaned.split(/\s+/).length >= 4 ? cleaned : null;
}

export interface LeverShimOpts {
  /** Stable cluster id for the synthesised KPI (e.g. `heart_lever`). */
  kpiId: string;
}

export function leverToInsight(
  lever: MorningLeverCard | null,
  opts: LeverShimOpts,
): SleepInsightV3 | null {
  if (!lever) return null;
  const confidenceMap = { high: 0.85, medium: 0.6, low: 0.35 } as const;
  const headline = humanizeLeverId(lever.lever);
  const trajectory = sanitizeLeverProse(lever.trajectory);
  const projection = sanitizeLeverProse(lever.projection_90d);
  const analysisToday = trajectory ?? projection;
  return {
    schema_version: "use_case/sleep/v1",
    language: "de",
    abstain: false,
    abstain_reason: null,
    headline,
    summary_short: null,
    summary_long: analysisToday,
    analysis_today: analysisToday,
    analysis_context: projection,
    suggestions_today: [
      {
        reasoning: lever.tiny_next_step.tiny,
        anchor: lever.tiny_next_step.anchor,
        tiny: lever.tiny_next_step.tiny,
        why: analysisToday ?? headline,
        horizon: lever.tiny_next_step.horizon === "this_week"
          ? "today"
          : lever.tiny_next_step.horizon === "tomorrow"
            ? "today"
            : lever.tiny_next_step.horizon,
      },
    ],
    suggestions_long_term: [],
    kpis: [
      {
        id: opts.kpiId,
        label_de: headline,
        value: 0,
        band: "steady",
        reasoning: analysisToday ?? "—",
      },
    ],
    confidence: {
      reasoning: `Confidence aus dem Morgen-Briefing übernommen (${lever.confidence}).`,
      value: confidenceMap[lever.confidence],
    },
  };
}
