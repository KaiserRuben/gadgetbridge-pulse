/**
 * Per-domain confidence-rubric weight tables.
 * Each table sums to 1.0. Model fills score + rationale; weights are fixed.
 *
 * Mirrors COACH_PROMPTS.md §Confidence-factor catalogue.
 */

export type Factor = { factor: string; weight: number };

export const SLEEP_FACTORS: Factor[] = [
  { factor: "sample_size", weight: 0.25 },
  { factor: "data_quality", weight: 0.20 },
  { factor: "baseline_available", weight: 0.20 },
  { factor: "metric_completeness", weight: 0.15 },
  { factor: "apnea_index_computed", weight: 0.10 },
  { factor: "freshness", weight: 0.10 },
];

export const CARDIO_FACTORS: Factor[] = [
  { factor: "sample_size", weight: 0.20 },
  { factor: "data_quality", weight: 0.20 },
  { factor: "baseline_available", weight: 0.20 },
  { factor: "hrv_sample_density", weight: 0.15 },
  { factor: "hr_zone_coverage", weight: 0.15 },
  { factor: "freshness", weight: 0.10 },
];

export const ACTIVITY_FACTORS: Factor[] = [
  { factor: "sample_size", weight: 0.20 },
  { factor: "data_quality", weight: 0.15 },
  { factor: "step_sentinel_ratio", weight: 0.15 },
  { factor: "baseline_available", weight: 0.15 },
  { factor: "sedentary_block_visibility", weight: 0.15 },
  { factor: "metric_completeness", weight: 0.10 },
  { factor: "freshness", weight: 0.10 },
];

export const STRESS_FACTORS: Factor[] = [
  { factor: "sample_size", weight: 0.25 },
  { factor: "sample_density_per_hour", weight: 0.20 },
  { factor: "data_quality", weight: 0.15 },
  { factor: "baseline_available", weight: 0.15 },
  { factor: "coverage_balance", weight: 0.15 },
  { factor: "freshness", weight: 0.10 },
];

export const BODY_FACTORS: Factor[] = [
  { factor: "sample_size", weight: 0.25 },
  { factor: "temp_sample_density", weight: 0.15 },
  { factor: "data_quality", weight: 0.15 },
  { factor: "baseline_available", weight: 0.20 },
  { factor: "cross_sensor_agreement", weight: 0.10 },
  { factor: "metric_completeness", weight: 0.05 },
  { factor: "freshness", weight: 0.10 },
];

export const ANOMALIES_FACTORS: Factor[] = [
  { factor: "detection_window_size", weight: 0.30 },
  { factor: "threshold_clarity", weight: 0.25 },
  { factor: "biological_vs_quality_separation", weight: 0.15 },
  { factor: "correlation_evidence", weight: 0.15 },
  { factor: "baseline_available", weight: 0.10 },
  { factor: "freshness", weight: 0.05 },
];

export const COACH_FACTORS: Factor[] = [
  { factor: "inputs_completeness", weight: 0.30 },
  { factor: "inputs_confidence_avg", weight: 0.25 },
  { factor: "cross_domain_agreement", weight: 0.20 },
  { factor: "anomaly_clarity", weight: 0.10 },
  { factor: "baseline_available", weight: 0.10 },
  { factor: "freshness", weight: 0.05 },
];

export const FACTORS_BY_DOMAIN: Record<string, Factor[]> = {
  sleep: SLEEP_FACTORS,
  cardio: CARDIO_FACTORS,
  activity: ACTIVITY_FACTORS,
  stress: STRESS_FACTORS,
  body: BODY_FACTORS,
  anomalies: ANOMALIES_FACTORS,
  coach: COACH_FACTORS,
};

/** Sanity check at module load: each table sums to 1.0 within rounding. */
for (const [k, table] of Object.entries(FACTORS_BY_DOMAIN)) {
  const sum = table.reduce((s, f) => s + f.weight, 0);
  if (Math.abs(sum - 1.0) > 1e-9) {
    throw new Error(`confidence weights for ${k} sum to ${sum}, expected 1.0`);
  }
}
