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
}
