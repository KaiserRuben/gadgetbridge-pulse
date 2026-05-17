/**
 * V3 type definitions — single source of truth for the dashboard.
 *
 * Mirrors:
 *   runner/src/v3/schemas/sleep_insight.schema.json
 *   runner/src/v3/schemas/recovery_insight.schema.json
 *   runner/src/v3/schemas/activity_insight.schema.json
 *   runner/src/v3/schemas/synthesis_insight.schema.json
 *
 * Package types (raw inputs to the LLMs) are imported from the packager
 * modules so they stay in lockstep with the runner.
 */

// ── Re-export package types from the runner packagers ───────────────────────

export type {
  SleepPackage,
  SleepSummary,
  StageSegment,
  HrBucket,
  Spo2Bucket,
  NightSummary,
  DayAggregate,
  WorkoutEntry,
} from "@/runner/v3/packagers/sleep";

export type {
  RecoveryPackage,
  HrvPoint,
  RhrBlock,
  StressBlock,
  AwakeHrBucket,
  RecoveryDayAggregate,
  WorkoutLite,
} from "@/runner/v3/packagers/recovery";

export type {
  ActivityPackage,
  WorkoutFull,
  StepsHourly,
  SedentaryBlock,
  HrZones,
  ActivityDayAggregate,
} from "@/runner/v3/packagers/activity";

export type { BaselineStat, MetricDelta, DeltaBand } from "@/runner/v3/packagers/shared";

export type { DayScoreResult } from "@/runner/v3/day-score";

// ── Shared insight primitives ────────────────────────────────────────────────

export type Band = "above_usual" | "steady" | "below_usual";
export type HorizonShort = "today" | "tonight";
export type HorizonLong = "this_week" | "this_month";

export interface KpiItem {
  reasoning: string;
  id: string;
  label_de: string;
  value: number;
  band: Band;
}

export interface SuggestionToday {
  reasoning: string;
  anchor: string;
  tiny: string;
  why: string;
  horizon: HorizonShort;
}

export interface SuggestionLongTerm {
  reasoning: string;
  horizon: HorizonLong;
  action: string;
  why: string;
}

export interface ConfidenceBlock {
  reasoning: string;
  value: number;
}

// ── Sleep insight ────────────────────────────────────────────────────────────

export interface SleepInsightV3 {
  schema_version: "use_case/sleep/v1";
  language: "de" | "en";
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  analysis_today: string | null;
  analysis_context: string | null;
  suggestions_today: SuggestionToday[];
  suggestions_long_term: SuggestionLongTerm[];
  /** First 3 ids in order: sleep_quality, recovery_readiness, sleep_consistency. Optional 1-2 extras after. */
  kpis: KpiItem[];
  confidence: ConfidenceBlock;
}

// ── Recovery insight ────────────────────────────────────────────────────────

export interface RecoveryInsightV3 {
  schema_version: "use_case/recovery/v1";
  language: "de" | "en";
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  analysis_today: string | null;
  analysis_context: string | null;
  suggestions_today: SuggestionToday[];
  suggestions_long_term: SuggestionLongTerm[];
  /** First 3 ids in order: recovery_score, autonomic_balance, stress_load. Optional 1-2 extras after. */
  kpis: KpiItem[];
  confidence: ConfidenceBlock;
}

// ── Activity insight ────────────────────────────────────────────────────────

export interface ActivityInsightV3 {
  schema_version: "use_case/activity/v1";
  language: "de" | "en";
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  analysis_today: string | null;
  analysis_context: string | null;
  suggestions_today: SuggestionToday[];
  suggestions_long_term: SuggestionLongTerm[];
  /** First 3 ids in order: training_quality, volume_load, recovery_demand. Optional 1-2 extras after. */
  kpis: KpiItem[];
  confidence: ConfidenceBlock;
}

// ── Synthesis (daily_v3) insight ────────────────────────────────────────────

export type SourceDomain = "sleep" | "recovery" | "activity" | "cross_domain";
export type Domain = "sleep" | "recovery" | "activity";

export interface SynthesisTopAction {
  reasoning: string;
  source_domain: SourceDomain;
  anchor: string;
  tiny: string;
  why: string;
  horizon: HorizonShort;
}

export interface SynthesisDomainPointer {
  reasoning: string;
  domain: Domain;
  label_de: string;
  kpi_id: string;
  kpi_value: number;
  kpi_band: Band;
  callout: string;
}

export interface SynthesisContradiction {
  reasoning: string;
  domains: Domain[];
  conflict: string;
  resolution: string;
}

export interface SynthesisInsightV3 {
  schema_version: "use_case/synthesis/v1";
  language: "de" | "en";
  abstain: boolean;
  abstain_reason: string | null;
  verdict_band: Band | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  key_insight: string | null;
  top_action_today: SynthesisTopAction | null;
  /** Always 3 items in order: sleep, recovery, activity. */
  domain_pointers: [SynthesisDomainPointer, SynthesisDomainPointer, SynthesisDomainPointer];
  contradictions: SynthesisContradiction[];
  confidence: ConfidenceBlock;
}

// ── Aggregate type for the home page (loaded together) ───────────────────────

export interface DailyV3Bundle {
  date: string;
  daily: SynthesisInsightV3 | null;
  sleep: SleepInsightV3 | null;
  recovery: RecoveryInsightV3 | null;
  activity: ActivityInsightV3 | null;
  /** Deterministic 0-100 + band, computed in Stage A — used as hero ring fill. */
  day_score: { value: number; band: Band; reasoning: string } | null;
  /** True when daily_v3.json carries `incomplete: false`. */
  complete: boolean;
}
