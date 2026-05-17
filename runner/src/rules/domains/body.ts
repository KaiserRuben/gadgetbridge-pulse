/**
 * Body-domain rule runners (skin temp + SpO2).
 *
 * References:
 *   - Smarr et al. 2020 (Sci Reports): wearable skin-temperature deviation
 *     of ≥0.5°C above personal baseline plus elevated RHR can pre-empt
 *     symptomatic illness by ~2 days.
 *   - SpO2 < 88% during sleep: clinically relevant desaturation; safety tier.
 *   - SpO2 dips <90%: informative but not alarming on their own.
 */

import type { Observation, RuleEngineInput } from "../types.ts";
import {
  median,
  mad,
  zRobust,
  rollingMedianMAD,
  trailingConsecutive,
  compact,
} from "../stats.ts";
import { buildObservation, factor } from "../build.ts";

function bodyWindow(input: RuleEngineInput) {
  return {
    start_iso: input.facts.data_window.start_iso,
    end_iso: input.facts.data_window.end_iso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Skin-temperature pre-illness watch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trigger when:
 *   - skin_temp delta ≥ +0.5°C for 2 consecutive nights, AND
 *   - tonight's RHR is elevated (z ≥ +1 robust SD over 30d).
 *
 * Stage 0 supplies `history.skin_temp_delta_c_14d` (delta vs personal
 * baseline, °C). Until Mi Band 8/9 expose it, this rule will simply not
 * fire (returns []) — graceful degradation.
 */
export function runSkinTempIllness(input: RuleEngineInput): Observation[] {
  const skin = input.history.skin_temp_delta_c_14d ?? [];
  if (skin.length < 2) return [];

  const consec = trailingConsecutive(
    skin,
    (x): x is number => typeof x === "number" && x !== null && x >= 0.5,
  );
  if (consec < 2) return [];

  // RHR elevated: tonight's day-RHR z ≥ +1 over 30d.
  const rhrHist = input.history.rhr_day_bpm_30d ?? [];
  const tonightRhr = compact(rhrHist).at(-1);
  if (typeof tonightRhr !== "number") return [];
  const { median: med, mad: madVal, n } = rollingMedianMAD(rhrHist, 30);
  if (n < 14 || !Number.isFinite(med) || !Number.isFinite(madVal) || madVal === 0) return [];
  const z = zRobust(tonightRhr, med, madVal);
  if (z < 1) return [];

  const win = bodyWindow(input);
  const lastDelta = compact(skin).at(-1) ?? 0;
  return [
    buildObservation({
      id: "body_skin_temp_pre_illness",
      domain: "body",
      severity: "watch",
      tier: "S2",
      metric_id: "body.skin_temp_delta_c",
      evidence: ["body.skin_temp_delta_c", "cardio.rhr_day_bpm"],
      window: win,
      text_for_llm: `Skin-temp +${lastDelta.toFixed(2)}°C above personal baseline for ${consec}-consec nights and RHR ${z.toFixed(1)}σ above 30d median. Early-illness watch.`,
      direction: "up",
      confidence_factors: [
        factor("baseline_window_coverage", 0.3, Math.min(1, n / 30), `RHR n=${n}/30`),
        factor("signal_quality", 0.3, 0.7, "Skin-temp proxy"),
        factor("persistence_gate", 0.4, 1.0, `${consec}-consec ≥0.5°C + RHR↑`),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// SpO2 critical (during sleep)
// ─────────────────────────────────────────────────────────────────────────────

export function runSpo2Critical(input: RuleEngineInput): Observation[] {
  const spo2Min = input.facts.sleep?.metrics.spo2_min_pct;
  if (typeof spo2Min !== "number" || !Number.isFinite(spo2Min)) return [];
  if (spo2Min >= 88) return [];

  const win = bodyWindow(input);
  const sq = input.facts.sleep?.signal_quality.ok ?? false;
  return [
    buildObservation({
      id: "spo2_critical_low",
      domain: "body",
      severity: "critical",
      tier: "S1",
      metric_id: "sleep.spo2_min_pct",
      evidence: ["sleep.spo2_min_pct"],
      window: win,
      text_for_llm: `SpO2 dipped to ${spo2Min.toFixed(0)}% during sleep (<88%). Safety alert — verify wear and consider check-in.`,
      direction: "down",
      confidence_factors: [
        factor("baseline_window_coverage", 0.2, 0.5, "Absolute threshold"),
        factor("signal_quality", 0.4, sq ? 0.9 : 0.3, sq ? "OK" : "Verify wear/sensor"),
        factor("persistence_gate", 0.4, 1.0, "Single 5-min window"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// SpO2 dip count (mild, info)
// ─────────────────────────────────────────────────────────────────────────────

export function runSpo2DipMild(input: RuleEngineInput): Observation[] {
  const spo2Min = input.facts.sleep?.metrics.spo2_min_pct;
  if (typeof spo2Min !== "number" || !Number.isFinite(spo2Min)) return [];
  // Skip if the critical rule already fired.
  if (spo2Min < 88) return [];
  // Mild dip <90% — info-only.
  if (spo2Min >= 90) return [];

  const win = bodyWindow(input);
  return [
    buildObservation({
      id: "spo2_dip_mild",
      domain: "body",
      severity: "info",
      tier: null,
      metric_id: "sleep.spo2_min_pct",
      evidence: ["sleep.spo2_min_pct"],
      window: win,
      text_for_llm: `SpO2 minimum during sleep ${spo2Min.toFixed(0)}% — mild dip below 90%, monitor only.`,
      direction: "down",
      confidence_factors: [
        factor("baseline_window_coverage", 0.3, 0.5, ""),
        factor("signal_quality", 0.4, 0.7, "Spot reading"),
        factor("persistence_gate", 0.3, 0.5, "Info"),
      ],
    }),
  ];
}

export function runBodyDomain(input: RuleEngineInput): Observation[] {
  return [
    ...runSkinTempIllness(input),
    ...runSpo2Critical(input),
    ...runSpo2DipMild(input),
  ];
}
