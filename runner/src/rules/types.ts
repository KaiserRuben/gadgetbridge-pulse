/**
 * Internal rule-engine types.
 *
 * Re-exports the canonical {@link Observation} contract from @/lib/types/observations
 * (the locked PM type — never modified here) and adds engine-internal shapes that
 * never leak outside of `runner/src/rules/`.
 *
 * The rule engine is pure: given (facts, baselines, alarmState, currentLocalTime)
 * it deterministically produces an array of Observations plus an abstain flag.
 * NO LLM calls. NO I/O. NO randomness.
 */

import type {
  Observation,
  ObservationDomain,
  ObservationSeverity,
  AlarmTier,
  Direction,
  ConfidenceFactor,
  ActionHint,
  ObservationWindow,
} from "@/lib/types/observations";

import type { FactsBundleV2, BaselineCore, BaselineMap } from "@/lib/types/generated";

// Re-export the canonical types so domain runners only need to import from
// `./types` (or `../types`) and never reach into `@/lib/...` directly.
export type {
  Observation,
  ObservationDomain,
  ObservationSeverity,
  AlarmTier,
  Direction,
  ConfidenceFactor,
  ActionHint,
  ObservationWindow,
  FactsBundleV2,
  BaselineCore,
  BaselineMap,
};

/**
 * Mutable alarm state mirrors the AlarmStateV1 schema (state/v1).
 *
 * Kept here as a structural type rather than re-exported from generated.d.ts
 * because the generated interface uses `[k: string]: T | undefined` index
 * signatures which produce awkward narrowings; we want the same wire shape
 * but with cleaner local field semantics.
 */
export interface AlarmStateV1 {
  schema_version: "state/v1";
  /** Map of alarm/observation_id -> ISO date YYYY-MM-DD until which the alarm is snoozed. */
  snooze_until: Record<string, string | undefined>;
  /** Map of alarm/observation_id -> number of times the alarm has been dismissed. */
  dismissed_counts: Record<string, number | undefined>;
  /** Observation IDs the user has muted permanently. */
  muted_topics: string[];
}

/** Pause-state inputs the engine needs (not the full PauseStateV1). */
export interface PauseInputs {
  paused: boolean;
  i_feel_fine: boolean;
  /** ISO date YYYY-MM-DD of last DST/firmware/travel step-change detection, or null. */
  step_change_detected_on: string | null;
}

/**
 * History buffers required for persistence-gated rules. Each array is the
 * last N daily values, oldest first, newest last. Nulls represent missing
 * days (no data) and are skipped by stat helpers but counted by gate logic.
 *
 * Stage 0 (P3) is responsible for assembling these from raw GadgetBridge
 * samples; the engine itself only reads them.
 */
export interface RuleHistory {
  /** Most recent first? NO — oldest first, newest last. Index 0 = oldest. */
  rhr_day_bpm_30d?: (number | null)[];
  rhr_sleep_bpm_30d?: (number | null)[];
  rmssd_ms_30d?: (number | null)[];
  /** Sleep total time minutes per night, last 30 nights. */
  tst_min_30d?: (number | null)[];
  sleep_efficiency_pct_30d?: (number | null)[];
  sleep_latency_min_30d?: (number | null)[];
  /** Apnea event counts per night (max O2-desat events / hour buckets). */
  apnea_events_per_night_14d?: (number | null)[];
  /** Apnea max severity level per night, 0..3. */
  apnea_max_level_14d?: (number | null)[];
  /** Combined deep+REM minutes per night, last 14 nights. */
  deep_plus_rem_min_14d?: (number | null)[];
  /** Skin-temp delta from personal baseline (°C), per night. */
  skin_temp_delta_c_14d?: (number | null)[];
  /** Daily steps, last 30d. */
  steps_30d?: (number | null)[];
  /** Daily sedentary 90+ min block count. */
  sedentary_blocks_90min_14d?: (number | null)[];
  /** % of waking minutes flagged stress_high, last 7 days. */
  stress_high_pct_7d?: (number | null)[];
  /** Bedtime in minutes-from-midnight (local), last 7 nights — for step-change detection. */
  bedtime_min_7d?: (number | null)[];
  /** Total nights of usable sleep data observed since pipeline first run. */
  total_nights_observed?: number;
  /** ISO date YYYY-MM-DD of last firmware change recorded by Stage 0. */
  last_firmware_change_iso?: string | null;
  /** ISO date YYYY-MM-DD if a DST transition happened in the last 5 days. */
  recent_dst_transition_iso?: string | null;
}

/** Rule-engine input bundle. */
export interface RuleEngineInput {
  /** Today's facts bundle (single period). */
  facts: FactsBundleV2;
  /**
   * History buffers for trend / persistence rules. Stage 0 fills these from
   * the last 30 daily facts bundles plus a small set of derived series.
   */
  history: RuleHistory;
  /** Current alarm state (snooze / dismiss / mute). */
  alarmState: AlarmStateV1;
  /** Pause + i_feel_fine + step-change inputs. */
  pause: PauseInputs;
  /**
   * Current local time as ISO 8601. Anti-orthosomnia gating reads the hour
   * component from this string, NOT from `new Date()` — so the engine stays
   * deterministic and unit-testable.
   */
  currentLocalTime: string;
}

/** Rule-engine output bundle. */
export interface RuleEngineOutput {
  observations: Observation[];
  /** True if the engine produced no actionable observations and emitted nothing_notable. */
  abstain: boolean;
  /** Short English reason if abstain=true, null otherwise. */
  abstain_reason: string | null;
}

/** Helper alias for domain runner functions. Each runner is pure. */
export type DomainRunner = (input: RuleEngineInput) => Observation[];

/**
 * Internal severity → tier mapping helpers. The locked PM type allows tier
 * to be null (info / narrative) — these constants make rule code readable.
 */
export const TIER_S1: AlarmTier = "S1";
export const TIER_S2: AlarmTier = "S2";
export const TIER_S3: AlarmTier = "S3";
export const TIER_NONE: AlarmTier = null;
