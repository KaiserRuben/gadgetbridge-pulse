/**
 * Activity-domain rule runners.
 *
 * Two S3 nudges:
 *   - Step count below personal baseline: 30d median − 1σ for 3 of 5 days.
 *   - Sedentary blocks: ≥3 sedentary 90+ min blocks per day for ≥3 days.
 *
 * Both are S3 (contextual, low-friction). The user can dismiss them and
 * after two dismissals they are permanently muted.
 */

import type { Observation, RuleEngineInput } from "../types.ts";
import {
  rollingMedianMAD,
  zRobust,
  countLastN,
  trailingConsecutive,
  compact,
} from "../stats.ts";
import { buildObservation, factor, formatDeltaDe } from "../build.ts";

function activityWindow(input: RuleEngineInput) {
  return {
    start_iso: input.facts.data_window.start_iso,
    end_iso: input.facts.data_window.end_iso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps low
// ─────────────────────────────────────────────────────────────────────────────

export function runActivityStepLow(input: RuleEngineInput): Observation[] {
  const hist = input.history.steps_30d ?? [];
  const { median: med, mad: madVal, n } = rollingMedianMAD(hist, 30);
  if (n < 14 || !Number.isFinite(med) || !Number.isFinite(madVal) || madVal === 0) return [];

  const todaySteps = input.facts.activity.metrics.steps;
  if (typeof todaySteps !== "number" || !Number.isFinite(todaySteps)) return [];

  // 3 of last 5 days with z ≤ -1 (below baseline).
  const last5 = countLastN(
    hist,
    5,
    (x) =>
      typeof x === "number" && x !== null && Number.isFinite(x) && zRobust(x, med, madVal) <= -1,
  );
  if (last5.total < 5 || last5.hits < 3) return [];

  const z = zRobust(todaySteps, med, madVal);
  const win = activityWindow(input);
  const sq = input.facts.activity.signal_quality.ok;

  return [
    buildObservation({
      id: "activity_steps_low_pattern",
      domain: "activity",
      severity: "info",
      tier: "S3",
      metric_id: "activity.steps",
      evidence: ["activity.steps"],
      window: win,
      text_for_llm: `Steps ${Math.round(todaySteps)} (${z.toFixed(1)} robust SD vs 30d median ${Math.round(med)}). Below baseline on ${last5.hits} of last ${last5.total} days.`,
      delta_text: formatDeltaDe(todaySteps, med, "Schritte", "30-Tage"),
      direction: "down",
      confidence_factors: [
        factor("baseline_window_coverage", 0.4, Math.min(1, n / 30), `n=${n}/30`),
        factor("signal_quality", 0.3, sq ? 1.0 : 0.5, sq ? "OK" : "Wear gaps"),
        factor("persistence_gate", 0.3, last5.hits / 5, `${last5.hits}/${last5.total}`),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Sedentary blocks
// ─────────────────────────────────────────────────────────────────────────────

export function runActivitySedentary(input: RuleEngineInput): Observation[] {
  const hist = input.history.sedentary_blocks_90min_14d ?? [];
  const consec = trailingConsecutive(
    hist,
    (x): x is number => typeof x === "number" && x !== null && x >= 3,
  );
  if (consec < 3) return [];

  const lastBlocks = compact(hist).at(-1) ?? 0;
  const win = activityWindow(input);
  const sq = input.facts.activity.signal_quality.ok;
  return [
    buildObservation({
      id: "activity_sedentary_high",
      domain: "activity",
      severity: "info",
      tier: "S3",
      metric_id: "activity.sedentary_blocks_90min",
      evidence: ["activity.sedentary_minutes"],
      window: win,
      text_for_llm: `${lastBlocks} sedentary blocks of 90+ min today; ${consec} consecutive days at ≥3 such blocks.`,
      direction: "up",
      confidence_factors: [
        factor("baseline_window_coverage", 0.3, Math.min(1, hist.length / 14), `n=${hist.length}/14`),
        factor("signal_quality", 0.3, sq ? 1.0 : 0.5, ""),
        factor("persistence_gate", 0.4, 1.0, `${consec}-consec`),
      ],
    }),
  ];
}

export function runActivityDomain(input: RuleEngineInput): Observation[] {
  return [...runActivityStepLow(input), ...runActivitySedentary(input)];
}
