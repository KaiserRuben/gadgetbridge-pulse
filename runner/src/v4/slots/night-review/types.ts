/**
 * NightReviewPayload — last-night summary + KPIs.
 *
 * Slot scheduled for ~09:00 local (or wake+0min if sleep_complete fires).
 * Looks at the night that just ended (the period_key's wake-side sleep
 * window), compares vs last 2 nights + 30-day baseline, surfaces 0-3
 * actionable suggestions for the day ahead.
 *
 * Schema source: `runner/src/v4/schemas/slot-night-review.schema.json`.
 */

export type Band = "above_usual" | "steady" | "below_usual";

export type SleepStageName = "light" | "rem" | "deep" | "awake";

/**
 * One contiguous sleep-stage segment. Mirrored from
 * `night-review/package.ts → StageSegment` so the dashboard can render the
 * hypnogram without pulling in the packager module (Pi-side bundle stays
 * runner-free).
 */
export interface NightReviewStageSegment {
  start_iso: string;
  end_iso: string;
  stage: SleepStageName;
  duration_min: number;
}

export interface NightReviewSuggestion {
  reasoning: string;
  anchor: string;
  tiny: string;
  why: string;
  horizon: "today" | "tonight";
}

export interface NightReviewKpi {
  reasoning: string;
  id: string;
  label_de: string;
  value: number;
  band: Band;
}

export interface NightReviewConfidence {
  value: number;
  reasoning: string;
}

export interface NightReviewPayload {
  schema_version: "night-review/v1";
  language: "de" | "en";
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  analysis_today: string | null;
  analysis_context: string | null;
  suggestions_today: NightReviewSuggestion[];
  kpis: NightReviewKpi[];
  confidence: NightReviewConfidence;
  /**
   * Telemetry pass-through — NOT emitted by the LLM. Dispatcher injects the
   * packager's `domain.stages_timeline` after schema/grounding validation
   * succeeds, so the drill body can render the hypnogram without a separate
   * package fetch. Absent on slots that errored / abstained before injection.
   */
  stages_timeline?: NightReviewStageSegment[];
}
