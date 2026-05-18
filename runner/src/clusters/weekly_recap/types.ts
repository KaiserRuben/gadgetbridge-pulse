/**
 * Shape of the payload stored under the weekly_recap cluster.
 *
 * Mirrors the legacy `WeeklyRecapV2` (see `runner/src/schemas/v2/weekly.schema.json`
 * and `lib/types/generated.d.ts`) so the prose stage can dual-write
 * `weekly.json` byte-for-byte while also writing the JobCell row.
 *
 * Cell-key convention: the weekKey itself (`YYYY-W##`), e.g. `2026-W20`.
 * scope = "weekly" so the dispatcher and dashboard look in the right slot.
 *
 * Auto-process default is OFF (Phase 3 spec). The previous code path ran
 * weekly recaps automatically on every Sunday `day_end`; under the cluster
 * model the user must click "Erklärung anfordern" once per week, OR flip
 * `settings:auto_process` (or `settings:auto_process:weekly_recap`) on.
 * The legacy `stageW-weekly` caller in `v2-orchestrator.ts` remains alive
 * during the dual-write window so a silent-Sunday isn't possible.
 */

export interface WeeklyTrajectoryHeadline {
  recovery: string;
  activity: string;
  stress: string;
}

export interface WeeklyChartRef {
  chart_id: string;
  caption: string;
}

export interface WeeklyPatternCallout {
  id: string;
  description: string;
  occurrences: number;
  domains: string[];
  days: string[];
}

export interface WeeklyStreak {
  id: string;
  label: string;
  length_days: number;
  metric_id: string;
}

export interface WeeklyPersonalBest {
  metric_id: string;
  value: number;
  date: string;
  note: string | null;
}

export interface WeeklyPersonalWorst {
  metric_id: string;
  value: number;
  date: string;
  action_or_note: string;
}

export interface WeeklyMicroExperiment {
  hypothesis: string;
  anchor: string;
  tiny: string;
  fallback: string;
  target_metric_id: string;
  duration_days: number;
}

export interface WeeklyConfidence {
  value: number;
  calc: string;
  factors: string[];
}

export interface WeeklyRecapPayload {
  week_key: string;
  schema_version: "weekly/v2";
  language: "de" | "en";
  /** Empty in extract output, filled by prose when LLM runs. */
  reasoning_trace?: string;
  abstain: boolean;
  abstain_reason: string | null;
  trajectory_headline: WeeklyTrajectoryHeadline;
  chart_refs: WeeklyChartRef[];
  pattern_callouts: WeeklyPatternCallout[];
  streaks: WeeklyStreak[];
  personal_best: WeeklyPersonalBest | null;
  personal_worst: WeeklyPersonalWorst | null;
  micro_experiment: WeeklyMicroExperiment | null;
  confidence: WeeklyConfidence;
  /** Set by prose(); base model name, or "base+critic" once Phase 4 lands. */
  model?: string;
}

export interface WeeklyExtractInput {
  week_key: string;
}
