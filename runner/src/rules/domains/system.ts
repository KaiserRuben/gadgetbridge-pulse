/**
 * System-domain rule runners.
 *
 * These observations describe engine state rather than physiology:
 *   - cold_start_active: <14 nights of sleep history → pattern alarms gated.
 *   - pause_mode_active: user paused the system → S2/S3 suppressed.
 *   - user_override_felt_fine: user said "I feel fine today" → S2/S3
 *     suppressed for current local day.
 *   - nothing_notable: emitted by the engine top-level when no actionable
 *     observations remain post-suppression.
 *
 * Each is info-tier (severity=info, tier=null). They are *narrative
 * pegs* the prose stage uses to explain why the day's verdict is shaped
 * the way it is.
 */

import type { Observation, RuleEngineInput } from "../types.ts";
import { buildObservation, factor } from "../build.ts";

const COLD_START_NIGHTS = 14;

function sysWindow(input: RuleEngineInput) {
  return {
    start_iso: input.facts.data_window.start_iso,
    end_iso: input.facts.data_window.end_iso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cold start
// ─────────────────────────────────────────────────────────────────────────────

export function runColdStart(input: RuleEngineInput): Observation[] {
  const total = input.history.total_nights_observed ?? 0;
  if (total >= COLD_START_NIGHTS) return [];

  const win = sysWindow(input);
  return [
    buildObservation({
      id: "cold_start_active",
      domain: "system",
      severity: "info",
      tier: null,
      metric_id: "system.total_nights_observed",
      evidence: ["system.total_nights_observed"],
      window: win,
      text_for_llm: `Only ${total} of ${COLD_START_NIGHTS} nights of baseline data — pattern alarms are paused until baseline is established. Absolute safety thresholds still fire.`,
      direction: "flat",
      confidence_factors: [
        factor("baseline_window_coverage", 0.5, total / COLD_START_NIGHTS, `${total}/${COLD_START_NIGHTS}`),
        factor("signal_quality", 0.2, 1.0, "State"),
        factor("persistence_gate", 0.3, 1.0, "Direct count"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pause mode
// ─────────────────────────────────────────────────────────────────────────────

export function runPauseMode(input: RuleEngineInput): Observation[] {
  if (!input.pause.paused) return [];
  const win = sysWindow(input);
  return [
    buildObservation({
      id: "pause_mode_active",
      domain: "system",
      severity: "info",
      tier: null,
      metric_id: "system.pause",
      evidence: ["system.pause"],
      window: win,
      text_for_llm: `Pause mode is active: pattern (S2) and nudge (S3) observations are suppressed. Safety (S1) alarms still fire.`,
      direction: "flat",
      confidence_factors: [
        factor("baseline_window_coverage", 0.4, 1.0, ""),
        factor("signal_quality", 0.3, 1.0, ""),
        factor("persistence_gate", 0.3, 1.0, "Direct"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// I-feel-fine override
// ─────────────────────────────────────────────────────────────────────────────

export function runUserOverride(input: RuleEngineInput): Observation[] {
  if (!input.pause.i_feel_fine) return [];
  const win = sysWindow(input);
  return [
    buildObservation({
      id: "user_override_felt_fine",
      domain: "system",
      severity: "info",
      tier: null,
      metric_id: "system.i_feel_fine",
      evidence: ["system.i_feel_fine"],
      window: win,
      text_for_llm: `User asserted "I feel fine" today: S2 and S3 observations are suppressed. S1 safety alarms still fire.`,
      direction: "flat",
      confidence_factors: [
        factor("baseline_window_coverage", 0.4, 1.0, ""),
        factor("signal_quality", 0.3, 1.0, ""),
        factor("persistence_gate", 0.3, 1.0, "Direct"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Nothing notable (last-pass)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a `nothing_notable` observation. Called by the engine top-level when
 * post-suppression there are no S1/S2/S3 observations and fewer than 3
 * info-tier observations.
 */
export function buildNothingNotable(input: RuleEngineInput, reason: string): Observation {
  const win = sysWindow(input);
  return buildObservation({
    id: "nothing_notable",
    domain: "system",
    severity: "info",
    tier: null,
    metric_id: "system.abstain",
    evidence: [],
    window: win,
    text_for_llm: `No patterns to flag today. ${reason}`,
    direction: "flat",
    confidence_factors: [
      factor("baseline_window_coverage", 0.4, 1.0, ""),
      factor("signal_quality", 0.3, 1.0, ""),
      factor("persistence_gate", 0.3, 1.0, "Engine abstain"),
    ],
  });
}

export function runSystemDomain(input: RuleEngineInput): Observation[] {
  return [...runColdStart(input), ...runPauseMode(input), ...runUserOverride(input)];
}
