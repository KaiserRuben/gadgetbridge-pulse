/**
 * WeekSynthesisPayload — weekly rollup from up to 7 day_synthesis payloads.
 *
 * Schema: `runner/src/v4/schemas/slot-week-synthesis.schema.json`.
 */

export type Band = "above_usual" | "steady" | "below_usual";

export interface WeekAnchor {
  reasoning: string;
  signal: string;
  takeaway: string;
}

export interface WeekKpi {
  reasoning: string;
  id: string;
  label_de: string;
  value: number;
  band: Band;
}

export interface WeekConfidence {
  value: number;
  reasoning: string;
}

export interface WeekSynthesisPayload {
  schema_version: "week-synthesis/v1";
  language: "de" | "en";
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  week_narrative: string | null;
  top_anchors: WeekAnchor[];
  next_week_focus: string | null;
  kpis: WeekKpi[];
  confidence: WeekConfidence;
}
