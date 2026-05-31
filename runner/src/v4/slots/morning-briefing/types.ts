/**
 * MorningBriefingPayload — tone-setting brief for the day ahead.
 *
 * Reads night_review (prior) + tier1.context (plan, anomalies, pain flags).
 * No separate KPIs — uses night_review.kpis for recovery numbers.
 *
 * Schema: `runner/src/v4/schemas/slot-morning-briefing.schema.json`.
 */

export type PlanAdherenceStatus = "proceed" | "modify" | "skip" | "no_plan";

export interface MorningBriefingPlanAdherence {
  status: PlanAdherenceStatus;
  reasoning: string;
  recommendation: string | null;
}

export interface MorningBriefingSuggestion {
  reasoning: string;
  anchor: string;
  tiny: string;
  why: string;
  horizon: "now" | "morning" | "today";
}

export interface MorningBriefingConfidence {
  value: number;
  reasoning: string;
}

export interface MorningBriefingPayload {
  schema_version: "morning-briefing/v1";
  language: "de" | "en";
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  focus_today: string | null;
  plan_adherence: MorningBriefingPlanAdherence;
  suggestions_today: MorningBriefingSuggestion[];
  confidence: MorningBriefingConfidence;
}
