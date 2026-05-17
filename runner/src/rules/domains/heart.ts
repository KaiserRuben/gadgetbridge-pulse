/**
 * Heart-domain rule runners (RHR + HRV).
 *
 * References:
 *   - Plews 2014 (IJSPP): HRV log-transformation (lnRMSSD), require ≥3 valid
 *     nights/wk, individual baselines.
 *   - Resting HR drift: 14-day Mann–Kendall + Theil–Sen.
 *   - HRV CV-rising as a maladaptation marker (Plews & Laursen 2017 review).
 *
 * Locked tier policy:
 *   - RHR > 120 bpm sustained ≥10 min while awake → S1 safety alarm
 *     (the "tachycardia" check). NOT suppressed by pause / i_feel_fine.
 *   - RHR drift rising (Mann–Kendall p<0.05, Theil–Sen slope > 0.5×MAD/wk):
 *     S2 watch. Falling RHR drift: tier null (info; usually a positive sign).
 *   - HRV acute drop: lnRMSSD < (median_30d − 1.5σ) for tonight → S2.
 *   - HRV trend: 14-day Mann–Kendall on lnRMSSD with negative slope p<0.05 → S2.
 *   - HRV CV rising: 7-day CV of lnRMSSD > 30d-baseline-CV + 1σ → S2.
 */

import type { Observation, RuleEngineInput } from "../types.ts";
import {
  median,
  mad,
  zRobust,
  rollingMedianMAD,
  rollingMean,
  stdev,
  coefficientOfVariation,
  mannKendall,
  theilSen,
  lnRMSSDSeries,
  compact,
} from "../stats.ts";
import { buildObservation, directionFromZ, factor, formatDeltaDe } from "../build.ts";

function heartWindow(input: RuleEngineInput) {
  return {
    start_iso: input.facts.data_window.start_iso,
    end_iso: input.facts.data_window.end_iso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RHR safety (sustained tachycardia)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S1 sustained tachycardia. Stage 0 will eventually expose a derived
 * "rhr_awake_sustained_max_10min" facet on facts.cardio; until then we
 * inspect `cardio.metrics.hr_max_bpm`. If hr_max ≥ 120 we emit the alarm
 * conservatively — Stage 0 will refine to true sustained signal.
 */
export function runRhrSafety(input: RuleEngineInput): Observation[] {
  const hrMax = input.facts.cardio.metrics.hr_max_bpm;
  if (typeof hrMax !== "number" || !Number.isFinite(hrMax)) return [];
  if (hrMax < 120) return [];

  const win = heartWindow(input);
  const sq = input.facts.cardio.signal_quality.ok;
  return [
    buildObservation({
      id: "rhr_tachycardia_safety",
      domain: "heart",
      severity: "critical",
      tier: "S1",
      metric_id: "cardio.hr_max_bpm",
      evidence: ["cardio.hr_max_bpm"],
      window: win,
      text_for_llm: `Heart rate reached ${Math.round(hrMax)} bpm during the day. Sustained tachycardia (≥120 bpm) deserves a check-in.`,
      direction: "up",
      confidence_factors: [
        factor("baseline_window_coverage", 0.2, 0.5, "Absolute threshold"),
        factor("signal_quality", 0.4, sq ? 1.0 : 0.3, sq ? "OK" : "Verify wear"),
        factor("persistence_gate", 0.4, 1.0, "Single-window absolute"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// RHR drift (14-day trend)
// ─────────────────────────────────────────────────────────────────────────────

export function runRhrDrift(input: RuleEngineInput): Observation[] {
  const hist = input.history.rhr_day_bpm_30d ?? [];
  const last14 = compact(hist.slice(-14));
  if (last14.length < 10) return [];

  const mk = mannKendall(last14);
  const slopePerDay = theilSen(last14);
  const baseMad = mad(last14);
  const win = heartWindow(input);

  if (!Number.isFinite(slopePerDay) || !Number.isFinite(baseMad) || baseMad === 0) return [];

  // Threshold: |slope| × 7 (per week) > 0.5 × MAD/week (= 0.5 × MAD).
  const slopePerWeek = slopePerDay * 7;
  const sigSlope = Math.abs(slopePerWeek) > 0.5 * baseMad;
  const sig = mk.p < 0.05 && sigSlope;
  if (!sig) return [];

  const sq = input.facts.cardio.signal_quality.ok;
  const med = median(last14);
  const today = last14[last14.length - 1];

  if (slopePerDay > 0) {
    return [
      buildObservation({
        id: "rhr_drift_rising",
        domain: "heart",
        severity: "watch",
        tier: "S2",
        metric_id: "cardio.rhr_day_bpm",
        evidence: ["cardio.rhr_day_bpm"],
        window: win,
        text_for_llm: `RHR drifting up: 14-day Mann–Kendall p=${mk.p.toFixed(3)}, Theil–Sen slope ${slopePerWeek.toFixed(1)} bpm/week. Today ${Math.round(today)} bpm vs 14d median ${med.toFixed(0)} bpm.`,
        delta_text: formatDeltaDe(today, med, "bpm", "14-Tage"),
        direction: "up",
        confidence_factors: [
          factor("baseline_window_coverage", 0.4, Math.min(1, last14.length / 14), `n=${last14.length}/14`),
          factor("signal_quality", 0.3, sq ? 1.0 : 0.3, sq ? "OK" : "Degraded"),
          factor(
            "persistence_gate",
            0.3,
            Math.min(1, Math.abs(slopePerWeek) / Math.max(1, baseMad)),
            `slope=${slopePerWeek.toFixed(1)} bpm/wk, MAD=${baseMad.toFixed(1)}`,
          ),
        ],
      }),
    ];
  }
  // Falling RHR drift → narrative-only (info, no tier).
  return [
    buildObservation({
      id: "rhr_drift_falling",
      domain: "heart",
      severity: "info",
      tier: null,
      metric_id: "cardio.rhr_day_bpm",
      evidence: ["cardio.rhr_day_bpm"],
      window: win,
      text_for_llm: `RHR drifting down: 14-day slope ${slopePerWeek.toFixed(1)} bpm/week (Mann–Kendall p=${mk.p.toFixed(3)}). Often a positive recovery signal.`,
      delta_text: formatDeltaDe(today, med, "bpm", "14-Tage"),
      direction: "down",
      confidence_factors: [
        factor("baseline_window_coverage", 0.4, Math.min(1, last14.length / 14), `n=${last14.length}/14`),
        factor("signal_quality", 0.3, sq ? 1.0 : 0.3, ""),
        factor("persistence_gate", 0.3, 0.7, "14-day trend"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// HRV acute drop (single-night)
// ─────────────────────────────────────────────────────────────────────────────

export function runHrvLowAcute(input: RuleEngineInput): Observation[] {
  const sleep = input.facts.sleep;
  if (!sleep) return [];
  const tonight = sleep.metrics.rmssd_ms;
  if (typeof tonight !== "number" || !Number.isFinite(tonight) || tonight <= 0) return [];
  const lnTonight = Math.log(tonight);

  const histRaw = input.history.rmssd_ms_30d ?? [];
  const lnSeries = lnRMSSDSeries(histRaw);
  const finite = compact(lnSeries);
  if (finite.length < 7) return [];

  const m = median(finite);
  const v = mad(finite, m);
  if (!Number.isFinite(m) || !Number.isFinite(v) || v === 0) return [];

  const z = zRobust(lnTonight, m, v);
  if (z >= -1.5) return [];

  const win = heartWindow(input);
  const sq = sleep.signal_quality.ok;
  return [
    buildObservation({
      id: "hrv_low_acute",
      domain: "heart",
      severity: "watch",
      tier: "S2",
      metric_id: "sleep.rmssd_ms",
      evidence: ["sleep.rmssd_ms"],
      window: win,
      text_for_llm: `lnRMSSD ${lnTonight.toFixed(2)} (${z.toFixed(1)} robust SD vs 30d median ${m.toFixed(2)}). Single-night low HRV.`,
      delta_text: formatDeltaDe(
        Math.round(tonight),
        Math.round(Math.exp(m)),
        "ms",
        "30-Tage",
      ),
      direction: "down",
      confidence_factors: [
        factor("baseline_window_coverage", 0.4, Math.min(1, finite.length / 30), `n=${finite.length}/30`),
        factor("signal_quality", 0.3, sq ? 1.0 : 0.3, sq ? "OK" : "Degraded"),
        factor("persistence_gate", 0.3, 0.6, "Single-night"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// HRV trend (14-day Mann–Kendall on lnRMSSD)
// ─────────────────────────────────────────────────────────────────────────────

export function runHrvTrend(input: RuleEngineInput): Observation[] {
  const histRaw = input.history.rmssd_ms_30d ?? [];
  const lnSeries = compact(lnRMSSDSeries(histRaw)).slice(-14);
  if (lnSeries.length < 10) return [];

  const mk = mannKendall(lnSeries);
  const slope = theilSen(lnSeries);
  const baseMad = mad(lnSeries);
  if (!Number.isFinite(slope) || !Number.isFinite(baseMad) || baseMad === 0) return [];

  const slopePerWeek = slope * 7;
  const sig = mk.p < 0.05 && Math.abs(slopePerWeek) > 0.5 * baseMad;
  if (!sig || slope >= 0) return [];

  const win = heartWindow(input);
  const sq = input.facts.sleep?.signal_quality.ok ?? false;
  return [
    buildObservation({
      id: "hrv_trend_falling",
      domain: "heart",
      severity: "watch",
      tier: "S2",
      metric_id: "sleep.rmssd_ms",
      evidence: ["sleep.rmssd_ms"],
      window: win,
      text_for_llm: `HRV (lnRMSSD) trend falling over 14 days: Mann–Kendall p=${mk.p.toFixed(3)}, slope ${slopePerWeek.toFixed(2)} ln-units/wk.`,
      direction: "down",
      confidence_factors: [
        factor("baseline_window_coverage", 0.4, Math.min(1, lnSeries.length / 14), `n=${lnSeries.length}/14`),
        factor("signal_quality", 0.3, sq ? 1.0 : 0.3, sq ? "OK" : "Degraded"),
        factor("persistence_gate", 0.3, 0.9, "14-day Mann–Kendall"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// HRV coefficient of variation (maladaptation marker)
// ─────────────────────────────────────────────────────────────────────────────

export function runHrvCvRising(input: RuleEngineInput): Observation[] {
  const histRaw = input.history.rmssd_ms_30d ?? [];
  const lnFull = compact(lnRMSSDSeries(histRaw));
  if (lnFull.length < 21) return [];

  const last7 = lnFull.slice(-7);
  const baseline21 = lnFull.slice(0, lnFull.length - 7); // older portion
  if (last7.length < 5 || baseline21.length < 14) return [];

  const cv7 = coefficientOfVariation(last7);
  // Build a sliding-window CV distribution from baseline21 to estimate σ_CV.
  const cvSamples: number[] = [];
  for (let i = 0; i + 7 <= baseline21.length; i++) {
    cvSamples.push(coefficientOfVariation(baseline21.slice(i, i + 7)));
  }
  const cleanCvs = cvSamples.filter(Number.isFinite);
  if (cleanCvs.length < 3) return [];
  const cvMed = median(cleanCvs);
  const cvSd = stdev(cleanCvs);
  if (!Number.isFinite(cv7) || !Number.isFinite(cvMed) || !Number.isFinite(cvSd) || cvSd === 0) return [];

  if (cv7 <= cvMed + cvSd) return [];

  const win = heartWindow(input);
  const sq = input.facts.sleep?.signal_quality.ok ?? false;
  return [
    buildObservation({
      id: "hrv_cv_rising",
      domain: "heart",
      severity: "watch",
      tier: "S2",
      metric_id: "sleep.rmssd_ms",
      evidence: ["sleep.rmssd_ms"],
      window: win,
      text_for_llm: `HRV variability (7d lnRMSSD CV) ${(cv7 * 100).toFixed(1)}% vs baseline ${(cvMed * 100).toFixed(1)}%. Rising CV is a maladaptation/load marker.`,
      direction: "up",
      confidence_factors: [
        factor("baseline_window_coverage", 0.4, Math.min(1, lnFull.length / 21), `n=${lnFull.length}/21`),
        factor("signal_quality", 0.3, sq ? 1.0 : 0.3, ""),
        factor("persistence_gate", 0.3, 0.7, "7d window vs 21d baseline"),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level
// ─────────────────────────────────────────────────────────────────────────────

export function runHeartDomain(input: RuleEngineInput): Observation[] {
  return [
    ...runRhrSafety(input),
    ...runRhrDrift(input),
    ...runHrvLowAcute(input),
    ...runHrvTrend(input),
    ...runHrvCvRising(input),
  ];
}
