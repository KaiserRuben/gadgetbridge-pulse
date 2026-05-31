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
}
