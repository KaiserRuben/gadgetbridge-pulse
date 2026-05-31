/**
 * MiddayCheckPayload — light check-in at ~13:00 local.
 *
 * Schema: `runner/src/v4/schemas/slot-midday-check.schema.json`.
 */

export type MiddayStatusLabel =
  | "on_track"
  | "behind"
  | "ahead"
  | "deviated"
  | "no_signal";

export interface MiddayStatus {
  reasoning: string;
  label: MiddayStatusLabel;
  on_track: boolean;
}

export interface MiddayCourseCorrection {
  reasoning: string;
  anchor: string;
  tiny: string;
  why: string;
}

export interface MiddayConfidence {
  value: number;
  reasoning: string;
}

export interface MiddayCheckPayload {
  schema_version: "midday-check/v1";
  language: "de" | "en";
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  status: MiddayStatus;
  course_correction: MiddayCourseCorrection | null;
  next_window: string | null;
  confidence: MiddayConfidence;
}
