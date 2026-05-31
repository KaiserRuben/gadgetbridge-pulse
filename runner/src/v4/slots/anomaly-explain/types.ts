/**
 * AnomalyExplainPayload — user-triggered anomaly explanation.
 *
 * Schema: `runner/src/v4/schemas/slot-anomaly-explain.schema.json`.
 */

export type DriverWeight = "high" | "medium" | "low";

export interface LikelyDriver {
  reasoning: string;
  driver: string;
  evidence: string;
  weight: DriverWeight;
}

export interface AnomalyExplainConfidence {
  value: number;
  reasoning: string;
}

export interface AnomalyExplainPayload {
  schema_version: "anomaly-explain/v1";
  language: "de" | "en";
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  what_happened: string | null;
  likely_drivers: LikelyDriver[];
  what_to_watch: string | null;
  confidence: AnomalyExplainConfidence;
}
