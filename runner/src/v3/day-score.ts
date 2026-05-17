/**
 * Deterministic day-score (0-100) — pure math, no LLM.
 *
 * Z-composite of normalized metrics vs personal 30d baselines:
 *   sleep_efficiency (+), tst (+), rmssd (+), -rhr_drift (-), -stress_mean (-),
 *   activity_normalized (+, U-shape: too little or too much both penalize)
 *
 * Output 0-100. Hero ring reads this, not LLM confidence.
 *
 * Verdict band thresholds:
 *   ≥65 → above_usual
 *   ≤35 → below_usual
 *   else → steady
 */

import { zRobust } from "../rules/stats.ts";
import type { BaselineStat } from "./packagers/shared.ts";

export interface DayScoreInputs {
  sleep_efficiency_pct: number | null;
  tst_min: number | null;
  rmssd_ms: number | null;
  rhr_day_bpm: number | null;
  rhr_sleep_bpm: number | null;
  stress_mean: number | null;
  steps: number | null;
  active_minutes: number | null;
}

export interface DayScoreBaselines {
  sleep_efficiency_pct?: BaselineStat;
  tst_min?: BaselineStat;
  rmssd_ms?: BaselineStat;
  rhr_day_bpm?: BaselineStat;
  rhr_sleep_bpm?: BaselineStat;
  stress_mean?: BaselineStat;
  steps?: BaselineStat;
  active_minutes?: BaselineStat;
}

export interface DayScoreResult {
  value: number;
  band: "above_usual" | "steady" | "below_usual";
  contributions: Record<string, { z: number; weight: number; signed: number }>;
  weight_used: number;
  reasoning: string;
}

/** Per-metric weights. Sum doesn't need to be 1 — normalized at end. */
const WEIGHTS: Record<string, { weight: number; direction: 1 | -1 }> = {
  sleep_efficiency_pct: { weight: 0.20, direction: 1 },
  tst_min: { weight: 0.15, direction: 1 },
  rmssd_ms: { weight: 0.20, direction: 1 },
  rhr_drift_bpm: { weight: 0.10, direction: -1 },
  stress_mean: { weight: 0.15, direction: -1 },
  steps_z: { weight: 0.10, direction: 1 }, // U-shape applied externally before passing
  active_minutes: { weight: 0.10, direction: 1 },
};

const BAND_HIGH = 65;
const BAND_LOW = 35;

export function computeDayScore(
  inputs: DayScoreInputs,
  baselines: DayScoreBaselines,
): DayScoreResult {
  const contributions: Record<string, { z: number; weight: number; signed: number }> = {};
  let weightedSum = 0;
  let weightUsed = 0;

  for (const key of [
    "sleep_efficiency_pct",
    "tst_min",
    "rmssd_ms",
    "stress_mean",
    "active_minutes",
  ] as const) {
    const value = inputs[key];
    const b = baselines[key];
    if (value == null || !b || b.median == null || b.mad == null || b.mad <= 0) continue;
    const z = clampZ(zRobust(value, b.median, b.mad));
    const w = WEIGHTS[key].weight;
    const dir = WEIGHTS[key].direction;
    const signed = dir * z;
    contributions[key] = { z, weight: w, signed };
    weightedSum += signed * w;
    weightUsed += w;
  }

  // RHR drift — derived metric. Lower = better (negative drift contribution).
  if (inputs.rhr_day_bpm != null && inputs.rhr_sleep_bpm != null) {
    const drift = inputs.rhr_day_bpm - inputs.rhr_sleep_bpm;
    // No baseline for drift — use a heuristic: drift > +5 → -1z, drift > +10 → -2z, etc.
    const z = clampZ((drift - 5) / 3);
    const w = WEIGHTS.rhr_drift_bpm.weight;
    const dir = WEIGHTS.rhr_drift_bpm.direction;
    const signed = dir * z;
    contributions.rhr_drift_bpm = { z, weight: w, signed };
    weightedSum += signed * w;
    weightUsed += w;
  }

  // Steps — U-shape: too little OR too much penalize. Compute z from baseline,
  // then convert |z| to a signed contribution that peaks near baseline.
  if (inputs.steps != null && baselines.steps?.median != null && baselines.steps.mad != null && baselines.steps.mad > 0) {
    const rawZ = zRobust(inputs.steps, baselines.steps.median, baselines.steps.mad);
    // U-shape: 0 contribution at baseline, negative at extremes (>2z away).
    const absZ = Math.abs(rawZ);
    const uShape = absZ <= 1 ? 1 : absZ <= 2 ? 0 : -1;
    const w = WEIGHTS.steps_z.weight;
    const signed = uShape;
    contributions.steps_z = { z: rawZ, weight: w, signed };
    weightedSum += signed * w;
    weightUsed += w;
  }

  // Convert weighted z (typically -2..+2) to 0-100 score.
  // 0 z = 50; +1 z = 65; +2 z = 80; -1 z = 35; -2 z = 20.
  const meanZ = weightUsed > 0 ? weightedSum / weightUsed : 0;
  const value = clamp(Math.round(50 + 15 * meanZ), 0, 100);

  const band: DayScoreResult["band"] =
    value >= BAND_HIGH ? "above_usual" : value <= BAND_LOW ? "below_usual" : "steady";

  const reasoning = buildReasoning(value, band, contributions, weightUsed);

  return { value, band, contributions, weight_used: round2(weightUsed), reasoning };
}

function buildReasoning(
  value: number,
  band: DayScoreResult["band"],
  contributions: Record<string, { z: number; weight: number; signed: number }>,
  weightUsed: number,
): string {
  const top = Object.entries(contributions)
    .sort((a, b) => Math.abs(b[1].signed * b[1].weight) - Math.abs(a[1].signed * a[1].weight))
    .slice(0, 3)
    .map(([k, v]) => `${k}(z=${round1(v.z)}, signed=${round1(v.signed)})`)
    .join(", ");
  return `day_score=${value} (${band}). Weight coverage ${round2(weightUsed)}/1.0. Top drivers: ${top || "none"}.`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clampZ(z: number): number {
  return clamp(z, -3, 3);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
