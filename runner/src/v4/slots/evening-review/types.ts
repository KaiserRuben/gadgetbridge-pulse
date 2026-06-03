/**
 * EveningReviewPayload — reflects on the day so far + wind-down hint.
 *
 * Schema: `runner/src/v4/schemas/slot-evening-review.schema.json`.
 */

export type Band = "above_usual" | "steady" | "below_usual";
export type LoadAssessment = "light" | "moderate" | "hard" | "max" | "no_workout";

export interface EveningWorkoutImpact {
  reasoning: string;
  load_assessment: LoadAssessment;
  recovery_hint: string;
}

export interface EveningWindDown {
  reasoning: string;
  anchor: string;
  tiny: string;
  why: string;
}

export interface EveningKpi {
  reasoning: string;
  id: string;
  label_de: string;
  value: number;
  band: Band;
}

export interface EveningConfidence {
  value: number;
  reasoning: string;
}

/** 5-min HR bucket — `bpm_mean` is the only field the drill chart needs. */
export interface EveningHrBucket {
  ts_iso: string;
  bpm_mean: number;
}

/** Minutes spent in one HR zone (Rest/Easy/Aerobic/Threshold/Max). */
export interface EveningHrZoneMinute {
  label: string;
  minutes: number;
}

export interface EveningReviewPayload {
  schema_version: "evening-review/v1";
  language: "de" | "en";
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  day_so_far: string | null;
  workout_impact: EveningWorkoutImpact | null;
  wind_down_suggestion: EveningWindDown | null;
  kpis: EveningKpi[];
  confidence: EveningConfidence;
  /**
   * Telemetry pass-through — NOT emitted by the LLM. Dispatcher injects from
   * the package's `domain.hr_today` after validation. 5-min HR buckets from
   * local midnight to package build time.
   */
  hr_today?: EveningHrBucket[];
  /**
   * Telemetry pass-through. Minutes-in-zone for today's HR samples. Order
   * matches `HR_ZONES` in `lib/constants.ts`.
   */
  hr_zone_minutes?: EveningHrZoneMinute[];
}
