export type ObservationDomain =
  | "sleep" | "heart" | "body" | "stress"
  | "activity" | "training_load" | "data_quality" | "system";

export type ObservationSeverity = "info" | "watch" | "warn" | "critical";
export type AlarmTier = "S1" | "S2" | "S3" | null;
export type Direction = "up" | "down" | "flat";

export type ConfidenceFactor = {
  factor: string;
  weight: number;
  score: number;
  rationale: string;
};

export type ActionHint = {
  /** Existing behaviour to attach to (German prose) */
  anchor: string;
  /** ≤2-min action (German prose, starts with verb) */
  tiny: string;
  /** Fallback if barrier hits (German prose, starts with verb, may include implicit barrier) */
  fallback: string;
  horizon: "today" | "week";
};

export type ObservationWindow = {
  start_iso: string;
  end_iso: string;
};

/** Stable rule-engine output. LLM paraphrases via text_for_llm; never invents new observations. */
export type Observation = {
  /** Stable snake_case ID (e.g. "sleep_efficiency_low"). Never changes across versions. */
  id: string;
  domain: ObservationDomain;
  severity: ObservationSeverity;
  /** Alarm tier, or null = narrative only */
  tier: AlarmTier;
  /** Dotted path into facts.json (e.g. "sleep.efficiency_pct") */
  metric_id: string;
  /** Other metric_ids that justify this observation */
  evidence: string[];
  window: ObservationWindow;
  confidence: {
    value: number;
    factors: ConfidenceFactor[];
  };
  /** ENGLISH neutral fact — LLM rephrases to German prose */
  text_for_llm: string;
  /** German delta string (e.g. "+11 ms gegenüber 7-Tage-Schnitt") — null if no baseline */
  delta_text?: string | null;
  direction: Direction;
  /** Tiny-Habits action — only on tier !== null observations */
  action_hint?: ActionHint;
  /** IDs of suppression rules that fired against this observation */
  suppressed_by?: string[];
};
