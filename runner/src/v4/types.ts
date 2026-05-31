/**
 * v4 view-state contracts. Mirrors the JSON schemas in v4/schemas/*.
 *
 * Single source of truth for what the dashboard renders. Pi is the
 * single-writer; Mac POSTs slot/tier1 diffs via HTTP. View-state is
 * never read from PULSE_INSIGHT or fallback-walked over date folders.
 *
 * Per-slot payload types live next to their slot implementation in
 * v4/slots/<slot-id>/types.ts and are referenced here as type unions.
 */

import type { NightReviewPayload } from "./slots/night-review/types.ts";
import type { MorningBriefingPayload } from "./slots/morning-briefing/types.ts";
import type { MiddayCheckPayload } from "./slots/midday-check/types.ts";
import type { EveningReviewPayload } from "./slots/evening-review/types.ts";
import type { DaySynthesisPayload } from "./slots/day-synthesis/types.ts";
import type { PostWorkoutPayload } from "./slots/post-workout/types.ts";
import type { AnomalyExplainPayload } from "./slots/anomaly-explain/types.ts";
import type { WeekSynthesisPayload } from "./slots/week-synthesis/types.ts";

// ── Slot identifiers ────────────────────────────────────────────────────────

export const DAILY_SLOT_IDS = [
  "night_review",
  "morning_briefing",
  "midday_check",
  "evening_review",
  "day_synthesis",
] as const;

export const WEEKLY_SLOT_IDS = ["week_synthesis"] as const;

export const EVENT_SLOT_IDS = ["post_workout", "anomaly_explain"] as const;

export const ALL_SLOT_IDS = [
  ...DAILY_SLOT_IDS,
  ...WEEKLY_SLOT_IDS,
  ...EVENT_SLOT_IDS,
] as const;

export type DailySlotId = (typeof DAILY_SLOT_IDS)[number];
export type WeeklySlotId = (typeof WEEKLY_SLOT_IDS)[number];
export type EventSlotId = (typeof EVENT_SLOT_IDS)[number];
export type SlotId = DailySlotId | WeeklySlotId | EventSlotId;

// ── Slot status state machine ───────────────────────────────────────────────

export type SlotStatus =
  | "scheduled"   // future, not yet computed
  | "computing"   // worker claimed, LLM running
  | "fresh"       // computed_at within ttl/3
  | "aging"       // computed_at within ttl
  | "stale"       // past ttl, still rendered with warning
  | "missed"      // scheduled_for + ttl past, no compute attempted
  | "errored"     // last attempt failed, retry_after_ms set
  | "abstained"   // intentional skip (data too thin)
  | "degraded";   // computed but missing prior slot input

// ── Compute receipt ─────────────────────────────────────────────────────────

export interface ComputedBy {
  model: string;
  slot_version: string;   // e.g. "morning-briefing/v1"
  prompt_version: string; // e.g. "p1-morning-briefing"
}

export interface PriorSlotRef {
  slot_id: SlotId;
  scheduled_for: string;
  computed_at: string;
}

export interface DataWindow {
  from: string;
  to: string;
}

export interface InputsUsed {
  prior_slot_refs: PriorSlotRef[];
  data_window: DataWindow;
  facts_hash: string;
}

export interface SlotError {
  code: string;
  message: string;
  retry_after_ms?: number;
}

// ── SlotEntry envelope (generic over payload) ───────────────────────────────

export interface SlotEntry<P = unknown> {
  slot_id: SlotId;
  status: SlotStatus;
  scheduled_for: string;        // ISO; when SHOULD have been computed by
  ttl_ms: number;               // window after scheduled_for during which fresh→aging
  computed_at: string | null;
  computed_by: ComputedBy | null;
  payload: P | null;
  inputs_used: InputsUsed | null;
  error: SlotError | null;
  degraded_reason: string | null;
  request_count: number;
  version: number;              // monotonic per-SlotEntry, bumped on every write
}

// ── Event slot extensions ───────────────────────────────────────────────────

export interface WorkoutRef {
  ts_start_iso: string;
  ts_end_iso: string;
  kind: number;
}

export interface PostWorkoutSlotEntry extends SlotEntry<PostWorkoutPayload> {
  slot_id: "post_workout";
  event_id: string;
  workout_ref: WorkoutRef;
}

export interface AnomalyExplainSlotEntry
  extends SlotEntry<AnomalyExplainPayload> {
  slot_id: "anomaly_explain";
  event_id: string;
  observation_id: string;
}

// ── Tier 1 (deterministic, regen every 60s) ─────────────────────────────────

export type Band = "above_usual" | "below_usual" | "steady";

export interface Point {
  date: string;
  value: number | null;
}

export interface FactsNow {
  now_ms: number;
  last_db_sample_at: string | null;
  data_lag_min: number | null;
  sleeping_in_progress: boolean;
  last_workout_end_at: string | null;
  hr_now: number | null;
}

export interface KpiWorkout {
  ts_start_iso: string;
  ts_end_iso: string;
  kind: number;
  duration_min: number;
  distance_m: number | null;
  active_kcal: number | null;
  workout_load: number | null;
  name: string | null;
}

export interface DayScore {
  value: number | null;
  band: Band | null;
  reasoning: string | null;
}

export interface KpisToday {
  tst_min: number | null;
  sleep_eff_pct: number | null;
  rmssd_ms: number | null;
  rhr_sleep_bpm: number | null;
  rhr_day_bpm: number | null;
  steps: number | null;
  active_kcal: number | null;
  stress_mean: number | null;
  day_score: DayScore;
  workouts: KpiWorkout[];
}

export interface Kpis14d {
  sleep_quality_series: Point[];
  autonomic_balance_series: Point[];
  volume_load_series: Point[];
  day_score_series: Point[];
}

export interface SessionTemplateRef {
  template_id: string;
  kind: string;
  intensity: "recovery" | "easy" | "moderate" | "hard" | "max";
  duration_min: number;
}

export interface PainFlag {
  region: string;
  severity: number;
  set_at: string;
}

export interface AnomalyEvent {
  code: string;
  severity: "info" | "warn" | "critical";
  headline_de: string;
  message_de: string;
  metric: string;
  value: number | null;
}

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface Tier1Context {
  day_of_week: DayOfWeek;
  is_weekend: boolean;
  plan_session_today: SessionTemplateRef | null;
  pain_flags_active: PainFlag[];
  anomalies_today: AnomalyEvent[];
}

export interface Tier1 {
  computed_at: string;
  facts_now: FactsNow;
  kpis_today: KpisToday;
  kpis_14d: Kpis14d;
  context: Tier1Context;
}

// ── ViewState meta ──────────────────────────────────────────────────────────

export type PipelineHealth = "ok" | "degraded" | "stalled";

export interface HeldBack {
  slot_id: SlotId;
  reason: string;
}

export interface ViewStateMeta {
  next_refresh_at: string;
  last_runner_heartbeat: string;
  last_phone_sync_at: string | null;
  pipeline_health: PipelineHealth;
  held_back: HeldBack[];
}

// ── ViewState (top-level) ───────────────────────────────────────────────────

export type Scope = "daily" | "weekly";

export interface ViewStateDailySlots {
  night_review: SlotEntry<NightReviewPayload>;
  morning_briefing: SlotEntry<MorningBriefingPayload>;
  midday_check: SlotEntry<MiddayCheckPayload>;
  evening_review: SlotEntry<EveningReviewPayload>;
  day_synthesis: SlotEntry<DaySynthesisPayload>;
}

export interface ViewStateWeeklySlots {
  week_synthesis: SlotEntry<WeekSynthesisPayload>;
}

export interface ViewStateEvents {
  post_workout: PostWorkoutSlotEntry[];
  anomaly_explain: AnomalyExplainSlotEntry[];
}

export interface ViewStateDaily {
  schema_version: "view/v1";
  period_key: string;            // YYYY-MM-DD
  scope: "daily";
  generated_at: string;
  tier1: Tier1;
  slots: ViewStateDailySlots;
  events: ViewStateEvents;
  meta: ViewStateMeta;
  version: number;
}

export interface ViewStateWeekly {
  schema_version: "view/v1";
  period_key: string;            // YYYY-Www
  scope: "weekly";
  generated_at: string;
  tier1: Tier1;                  // week-aggregated tier1 (kpis_today becomes kpis_week)
  slots: ViewStateWeeklySlots;
  events: ViewStateEvents;
  meta: ViewStateMeta;
  version: number;
}

export type ViewState = ViewStateDaily | ViewStateWeekly;

// ── Write-side diff shapes (Mac → Pi PATCH payloads) ────────────────────────

export interface Tier1Diff {
  scope: Scope;
  period_key: string;
  tier1: Tier1;
  expected_version: number;      // CAS: must match current view.version
}

export interface SlotDiff<P = unknown> {
  scope: Scope;
  period_key: string;
  slot_id: SlotId;
  event_id?: string;             // present for event slots (post_workout, anomaly_explain)
  entry: SlotEntry<P>;
  expected_version: number;      // CAS
}

export interface MetaDiff {
  scope: Scope;
  period_key: string;
  meta: Partial<ViewStateMeta>;
  expected_version: number;
}
