/**
 * Helpers for constructing Observation objects with the correct shape.
 *
 * Domain runners call `buildObservation({...})` which fills in defaults
 * (confidence factors, evidence array, direction inference) and returns an
 * Observation that satisfies the locked PM type from @/lib/types/observations.
 */

import type {
  AlarmTier,
  ConfidenceFactor,
  Direction,
  Observation,
  ObservationDomain,
  ObservationSeverity,
  ObservationWindow,
  ActionHint,
} from "./types.ts";

export interface BuildObservationArgs {
  id: string;
  domain: ObservationDomain;
  severity: ObservationSeverity;
  tier: AlarmTier;
  metric_id: string;
  evidence?: string[];
  window: ObservationWindow;
  text_for_llm: string;
  delta_text?: string | null;
  direction: Direction;
  /**
   * Per-observation confidence factors. Use the 3-factor schema:
   *   - baseline_window_coverage
   *   - signal_quality
   *   - persistence_gate
   * Each factor has weight ∈ [0,1] (sum to 1) and score ∈ [0,1].
   * If omitted, default factors are filled with score=0.5.
   */
  confidence_factors?: ConfidenceFactor[];
  /** Optional precomputed confidence value; otherwise weighted sum of factors. */
  confidence_value?: number;
  action_hint?: ActionHint;
}

const DEFAULT_FACTORS: ConfidenceFactor[] = [
  {
    factor: "baseline_window_coverage",
    weight: 0.4,
    score: 0.5,
    rationale: "Baseline coverage unknown — default mid-confidence.",
  },
  {
    factor: "signal_quality",
    weight: 0.3,
    score: 0.5,
    rationale: "Signal quality unknown — default mid-confidence.",
  },
  {
    factor: "persistence_gate",
    weight: 0.3,
    score: 0.5,
    rationale: "Persistence gate not specified — default mid-confidence.",
  },
];

/**
 * Compute weighted confidence value from factors. Clamps to [0,1].
 * If weights don't sum to 1 they are normalised.
 */
export function computeConfidence(factors: ConfidenceFactor[]): number {
  if (factors.length === 0) return 0;
  let totalW = 0;
  for (const f of factors) totalW += f.weight;
  if (totalW <= 0) return 0;
  let acc = 0;
  for (const f of factors) acc += (f.weight / totalW) * f.score;
  return Math.max(0, Math.min(1, acc));
}

export function buildObservation(args: BuildObservationArgs): Observation {
  const factors = args.confidence_factors ?? DEFAULT_FACTORS;
  const value =
    typeof args.confidence_value === "number"
      ? args.confidence_value
      : computeConfidence(factors);

  const obs: Observation = {
    id: args.id,
    domain: args.domain,
    severity: args.severity,
    tier: args.tier,
    metric_id: args.metric_id,
    evidence: args.evidence ?? [],
    window: args.window,
    confidence: { value, factors },
    text_for_llm: args.text_for_llm,
    delta_text: args.delta_text ?? null,
    direction: args.direction,
  };
  if (args.action_hint) obs.action_hint = args.action_hint;
  return obs;
}

/**
 * Convenience: build a confidence factor with the given score.
 *
 * Score conventions:
 *   - baseline_window_coverage: clamp(n / required, 0, 1)
 *   - signal_quality: 1 if signal_quality.ok, else 0.3
 *   - persistence_gate: 0.6 if 1 trigger, 0.8 if 2-consec, 1.0 if 3-consec/abs
 */
export function factor(
  name: string,
  weight: number,
  score: number,
  rationale: string,
): ConfidenceFactor {
  return { factor: name, weight, score: Math.max(0, Math.min(1, score)), rationale };
}

/**
 * Direction from a z-score. Threshold ≥0.25 in absolute value to avoid
 * labelling near-zero observations as "up" or "down".
 */
export function directionFromZ(z: number): Direction {
  if (!Number.isFinite(z)) return "flat";
  if (z >= 0.25) return "up";
  if (z <= -0.25) return "down";
  return "flat";
}

/**
 * Direction from a Theil-Sen slope. Same threshold logic as z, but
 * scaled by the absolute median-of-slopes is too involved — caller passes
 * a reference scale (e.g. 0.5 × MAD/week) and we compare.
 */
export function directionFromSlope(slope: number, scale: number): Direction {
  if (!Number.isFinite(slope) || !Number.isFinite(scale) || scale <= 0) return "flat";
  if (slope >= 0.25 * scale) return "up";
  if (slope <= -0.25 * scale) return "down";
  return "flat";
}

/**
 * German-formatted delta text helper.
 *
 *   formatDeltaDe(64, 58, "bpm")           → "+6 bpm gegenüber 30-Tage-Median"
 *   formatDeltaDe(36, 47, "ms")            → "−11 ms gegenüber 30-Tage-Median"
 *   formatDeltaDe(64, 58, "bpm", "7-Tage") → "+6 bpm gegenüber 7-Tage-Median"
 *
 * delta is rounded to 1 decimal if not integer-valued.
 */
export function formatDeltaDe(
  current: number,
  baseline: number,
  unit: string,
  windowLabel = "30-Tage",
): string {
  const d = current - baseline;
  if (!Number.isFinite(d)) return "";
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  const abs = Math.abs(d);
  const rounded = Number.isInteger(abs) ? abs.toString() : abs.toFixed(1);
  return `${sign}${rounded} ${unit} gegenüber ${windowLabel}-Median`;
}
