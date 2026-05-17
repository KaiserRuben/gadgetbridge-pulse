/**
 * Stress-domain rule runners.
 *
 * The Mi Band stress score is a derived 0–100 number from the firmware,
 * which already composites HRV, motion, and HR. Per the locked architecture,
 * derived scores must NEVER drive S1 — but a 7-day pattern of high-stress
 * minutes is a useful S2 watch signal because it correlates with the user's
 * subjective "I'm running hot" state.
 *
 * Rule:
 *   - 7-day rolling stress_high_pct ≥ 25% on 5 of 7 days → S2
 *   - Single-day spike (high_stress_minutes > 240 min) → S3 nudge
 */

import type { Observation, RuleEngineInput } from "../types.ts";
import { countLastN, compact } from "../stats.ts";
import { buildObservation, factor } from "../build.ts";

function stressWindow(input: RuleEngineInput) {
  return {
    start_iso: input.facts.data_window.start_iso,
    end_iso: input.facts.data_window.end_iso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chronic stress
// ─────────────────────────────────────────────────────────────────────────────

export function runStressChronicity(input: RuleEngineInput): Observation[] {
  const hist = input.history.stress_high_pct_7d ?? [];
  const hits = countLastN(
    hist,
    7,
    (x) => typeof x === "number" && x !== null && x >= 25,
  );
  const out: Observation[] = [];

  const win = stressWindow(input);
  const sq = input.facts.stress.signal_quality.ok;

  if (hits.total >= 7 && hits.hits >= 5) {
    out.push(
      buildObservation({
        id: "stress_chronicity_high",
        domain: "stress",
        severity: "watch",
        tier: "S2",
        metric_id: "stress.high_stress_minutes",
        evidence: ["stress.high_stress_minutes", "stress.stress_mean"],
        window: win,
        text_for_llm: `High-stress minutes ≥25% of waking time on ${hits.hits} of last 7 days. Chronic-stress pattern.`,
        direction: "up",
        confidence_factors: [
          factor("baseline_window_coverage", 0.3, Math.min(1, hits.total / 7), `n=${hits.total}/7`),
          factor("signal_quality", 0.3, sq ? 1.0 : 0.4, sq ? "OK" : "Sparse stress data"),
          factor("persistence_gate", 0.4, hits.hits / 7, `${hits.hits}/${hits.total}`),
        ],
      }),
    );
  }

  // Single-day spike → S3 nudge (only if chronic rule didn't already fire).
  if (out.length === 0) {
    const spike = input.facts.stress.metrics.high_stress_minutes;
    if (typeof spike === "number" && spike > 240) {
      out.push(
        buildObservation({
          id: "stress_single_day_spike",
          domain: "stress",
          severity: "info",
          tier: "S3",
          metric_id: "stress.high_stress_minutes",
          evidence: ["stress.high_stress_minutes"],
          window: win,
          text_for_llm: `${Math.round(spike)} min in high-stress range today (>240 min).`,
          direction: "up",
          confidence_factors: [
            factor("baseline_window_coverage", 0.2, 0.5, "Single-day"),
            factor("signal_quality", 0.4, sq ? 1.0 : 0.4, ""),
            factor("persistence_gate", 0.4, 0.6, "Single-day spike"),
          ],
        }),
      );
    }
  }

  return out;
}

export function runStressDomain(input: RuleEngineInput): Observation[] {
  return [...runStressChronicity(input)];
}
