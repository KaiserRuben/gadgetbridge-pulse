/**
 * DaySynthesisPayload — end-of-day narrative + 3 KPIs + tomorrow's frame.
 *
 * Composes night_review + morning_briefing + midday_check + evening_review
 * payloads with tier1.kpis_today as anchor numbers. Soft-degrades when
 * any non-evening prior is missing.
 *
 * Schema: `runner/src/v4/schemas/slot-day-synthesis.schema.json`.
 */

export type Band = "above_usual" | "steady" | "below_usual";

export interface DaySynthesisAnchor {
  reasoning: string;
  signal: string;
  takeaway: string;
}

export interface DaySynthesisKpi {
  reasoning: string;
  id: string;
  label_de: string;
  value: number;
  band: Band;
}

export interface DaySynthesisConfidence {
  value: number;
  reasoning: string;
}

export interface DaySynthesisPayload {
  schema_version: "day-synthesis/v1";
  language: "de" | "en";
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  narrative: string | null;
  top_anchors: DaySynthesisAnchor[];
  tomorrow_focus: string | null;
  kpis: DaySynthesisKpi[];
  confidence: DaySynthesisConfidence;
}
