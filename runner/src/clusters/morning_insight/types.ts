/**
 * Shape of the payload stored under the `morning_insight` cluster.
 *
 * Mirrors the legacy `MorningInsightV1` schema at
 * `runner/src/v3/schemas/morning_insight.schema.json` so the prose stage
 * can dual-write `morning_insight.json` byte-for-byte while also writing
 * the JobCell row.
 *
 * Cell-key convention: the wake-date itself (`YYYY-MM-DD`). scope =
 * "daily". The worker derives the extract input from the cell key (see
 * `parseMorningInputFromKey`).
 *
 * Auto-process default is OFF (Phase 3 spec). The legacy
 * `runV3Cluster("morning", …)` path auto-fires on every `sleep_complete`
 * + `day_end` via the event subscribers, so a silent-morning isn't
 * possible during the dual-write window. Flip `settings:auto_process`
 * (global) or `settings:auto_process:morning_insight` (per-cluster) to
 * restore the automatic cluster recompute.
 *
 * The dashboard's `lib/v3-loaders.ts` re-exports `MorningInsightPayload`
 * as the read-side `MorningInsight` type so there's one source of truth
 * for the shape on both halves.
 */

export type MorningHorizon = "morning" | "midday" | "afternoon" | "evening" | "day";
export type MorningStepHorizon = "today" | "tonight" | "tomorrow" | "this_week";
export type MorningVerdictBand = "above_usual" | "steady" | "below_usual";
export type MorningLeverConfidence = "high" | "medium" | "low";

export interface MorningTrainingRecommendation {
  reasoning: string;
  suggested_session_template_id: string | null;
  justification_de: string | null;
  alternatives: string[];
}

export interface MorningDayShapeStep {
  reasoning: string;
  anchor: string;
  action_de: string;
  horizon: MorningHorizon;
}

export interface MorningCareForItem {
  reasoning: string;
  area_de: string;
  why_de: string;
  action_de: string;
}

export interface MorningTinyNextStep {
  anchor: string;
  tiny: string;
  horizon: MorningStepHorizon;
}

export interface MorningLeverCard {
  reasoning: string;
  lever: string;
  domain: string;
  confidence: MorningLeverConfidence;
  trajectory: string;
  projection_90d: string;
  interpretation?: string | null;
  tiny_next_step: MorningTinyNextStep;
}

export interface MorningCitation {
  kind: string;
  ref_id: string;
  summary: string;
}

export interface MorningConfidence {
  value: number;
  reasoning: string;
}

export interface MorningInsightPayload {
  schema_version: "use_case/morning/v1";
  /**
   * Auto-injected by the legacy writer: true = artifact still in-flight
   * or failed validation; writer flips to false at atomic-rename time.
   * The cluster preserves this flag on the dual-written file so existing
   * dashboard readers (which gate on `incomplete === false`) keep working.
   */
  incomplete: boolean;
  language: "de" | "en";
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  verdict_band: MorningVerdictBand | null;
  training_recommendation: MorningTrainingRecommendation;
  day_shape: MorningDayShapeStep[];
  care_for: MorningCareForItem[];
  levers: MorningLeverCard[];
  citations: MorningCitation[];
  confidence: MorningConfidence;
  /**
   * Cluster-only metadata. Not part of the legacy schema — added to the
   * JobCell payload so the worker can attach the model tag (and the
   * "base+critic" composition once Phase 4 lands) without polluting the
   * legacy `morning_insight.json` shape. Stripped on dual-write.
   */
  model?: string;
  /**
   * Cluster cell-key (wake-date YYYY-MM-DD). Mirrors the period_key.
   * Same approach as weekly_recap.week_key — convenient round-trip,
   * stripped on dual-write.
   */
  period_key?: string;
}

export interface MorningExtractInput {
  period_key: string;
}
