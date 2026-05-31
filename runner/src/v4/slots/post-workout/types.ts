/**
 * PostWorkoutPayload — per-workout reflection.
 *
 * Schema: `runner/src/v4/schemas/slot-post-workout.schema.json`.
 */

export type Band = "above_usual" | "steady" | "below_usual";
export type LoadLevel = "light" | "moderate" | "hard" | "max";

export interface LoadAssessment {
  reasoning: string;
  level: LoadLevel;
  vs_recent: string;
}

export interface RecoveryWindow {
  reasoning: string;
  hours_estimated: number | null;
  guidance: string;
}

export interface FuelingHint {
  reasoning: string;
  anchor: string;
  tiny: string;
  why: string;
}

export interface PostWorkoutKpi {
  reasoning: string;
  id: string;
  label_de: string;
  value: number;
  band: Band;
}

export interface PostWorkoutConfidence {
  value: number;
  reasoning: string;
}

export interface PostWorkoutPayload {
  schema_version: "post-workout/v1";
  language: "de" | "en";
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  load_assessment: LoadAssessment;
  recovery_window: RecoveryWindow;
  fueling_hint: FuelingHint | null;
  next_session_hint: string | null;
  kpis: PostWorkoutKpi[];
  confidence: PostWorkoutConfidence;
}
