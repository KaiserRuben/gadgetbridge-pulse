/**
 * Slot registry — central declaration of every slot, its schedule
 * defaults, ttl, dependencies, and which events bump its scheduled_for
 * forward.
 *
 * The scheduler reads this registry to build per-period calendars.
 * The worker reads it to know which slots to process. The UI reads it
 * (via /api/view) to know how to label time anchors.
 *
 * In Phase 0 this is the declaration only — packager/prompt/validate
 * for each slot land in Phase 1.
 */

import type { SlotId, Scope, SlotStatus } from "../types.ts";

/** Event names the scheduler can hook off. */
export type BumpEvent =
  | "sleep_complete"      // new HUAWEI_SLEEP_STATS_SAMPLE row, wake-side
  | "workout_complete"    // new BASE_ACTIVITY_SUMMARY row
  | "day_end"             // hourly sweep + 23:00 local
  | "manual"              // CLI or UI retry
  | "anomaly_detected";   // new S1/S2 observation flagged

/** How a slot defaults its scheduled_for relative to the period_key. */
export interface DefaultSchedule {
  /** Local-time anchor (Europe/Berlin) for daily slots, or week-relative for weekly. */
  local_time?: string;            // "HH:MM" e.g. "08:00"
  /** Offset (ms) from a bump event when no fixed time is set. */
  offset_after_event_ms?: number; // e.g. 5 * 60_000
}

export interface SlotRegistryEntry {
  slot_id: SlotId;
  scope: Scope;
  /** When the slot defaults to firing for a period. */
  default_schedule: DefaultSchedule;
  /** ttl after scheduled_for during which fresh→aging. Past = stale. */
  ttl_ms: number;
  /**
   * Events that bump scheduled_for forward to "now + offset". If a slot
   * is bumped while already in scheduled state, scheduler re-anchors it.
   * If already computed, scheduler may force-recompute (depending on
   * `recompute_on_bump`).
   */
  bump_events: ReadonlyArray<{
    event: BumpEvent;
    offset_ms: number;            // 0 = fire now
    recompute_on_bump?: boolean;  // default false — bump only re-anchors scheduled state
  }>;
  /** Prior slots this slot reads from its package. */
  depends_on: ReadonlyArray<SlotId>;
  /** Whether scheduler enqueues fresh slots without an event bump. */
  auto_schedule: boolean;
  /** Whether this slot can produce on a "live" / in-progress day. */
  fires_on_live_day: boolean;
  /** Worker priority (higher = sooner). */
  priority: number;
  /**
   * Status the slot starts in for a period before its scheduled_for arrives.
   * Almost always "scheduled".
   */
  initial_status: SlotStatus;
  /** Slot-version string, written into computed_by + payload schema_version. */
  slot_version: string;
  /**
   * Ollama model tag for this slot. If unset, dispatcher uses COACH_MODEL.
   * Use the big reasoning model (qwen3.6:latest) for slots that synthesize
   * numeric arcs + z-scores; use a faster prose model (gpt-oss:20b) for
   * slots that mostly retell a prior slot in plan/check-in form.
   */
  model?: string;
}

/** Daily slots (5 fixed). Local times in Europe/Berlin. */
export const DAILY_SLOTS: SlotRegistryEntry[] = [
  {
    slot_id: "night_review",
    scope: "daily",
    // Default: wake-time + 5min. Actual wake-time only known when sleep_complete
    // fires, so the *initial* scheduled_for is 09:00 (a guess) and it gets bumped
    // forward when the event lands. Live-day check prevents firing before wake.
    default_schedule: { local_time: "09:00" },
    ttl_ms: 22 * 60 * 60 * 1000,    // valid until next sleep_complete
    bump_events: [
      { event: "sleep_complete", offset_ms: 0, recompute_on_bump: true },
      { event: "manual", offset_ms: 0, recompute_on_bump: true },
    ],
    depends_on: [],
    auto_schedule: true,
    fires_on_live_day: true,
    priority: 90,
    initial_status: "scheduled",
    slot_version: "night-review/v1",
    model: "qwen3.6:latest",
  },
  {
    slot_id: "morning_briefing",
    scope: "daily",
    // Default: 08:00 local. If sleep_complete fires later than 07:50 → bump to
    // wake+10min instead. If sleep_complete already fired earlier and slot ran,
    // bump_events does nothing (recompute_on_bump=false).
    default_schedule: { local_time: "08:00" },
    ttl_ms: 6 * 60 * 60 * 1000,
    bump_events: [
      { event: "sleep_complete", offset_ms: 10 * 60_000 },
      { event: "manual", offset_ms: 0, recompute_on_bump: true },
    ],
    depends_on: ["night_review"],
    auto_schedule: true,
    fires_on_live_day: true,
    priority: 85,
    initial_status: "scheduled",
    slot_version: "morning-briefing/v1",
    model: "gpt-oss:20b",
  },
  {
    slot_id: "midday_check",
    scope: "daily",
    default_schedule: { local_time: "13:00" },
    ttl_ms: 4 * 60 * 60 * 1000,
    bump_events: [
      { event: "workout_complete", offset_ms: 30 * 60_000 },
      { event: "manual", offset_ms: 0, recompute_on_bump: true },
    ],
    depends_on: ["morning_briefing"],
    auto_schedule: true,
    fires_on_live_day: true,
    priority: 70,
    initial_status: "scheduled",
    slot_version: "midday-check/v1",
    model: "gpt-oss:20b",
  },
  {
    slot_id: "evening_review",
    scope: "daily",
    default_schedule: { local_time: "19:00" },
    ttl_ms: 4 * 60 * 60 * 1000,
    bump_events: [
      { event: "workout_complete", offset_ms: 45 * 60_000 },
      { event: "manual", offset_ms: 0, recompute_on_bump: true },
    ],
    depends_on: ["midday_check"],
    auto_schedule: true,
    fires_on_live_day: true,
    priority: 70,
    initial_status: "scheduled",
    slot_version: "evening-review/v1",
    model: "gpt-oss:20b",
  },
  {
    slot_id: "day_synthesis",
    scope: "daily",
    default_schedule: { local_time: "23:00" },
    ttl_ms: 24 * 60 * 60 * 1000,
    bump_events: [
      { event: "day_end", offset_ms: 0, recompute_on_bump: true },
      { event: "manual", offset_ms: 0, recompute_on_bump: true },
    ],
    depends_on: ["evening_review"],   // soft dep — can degrade if missing
    auto_schedule: true,
    fires_on_live_day: false,         // only on day-end / next day
    priority: 60,
    initial_status: "scheduled",
    slot_version: "day-synthesis/v1",
    model: "qwen3.6:latest",
  },
];

/** Weekly slots (1 fixed). */
export const WEEKLY_SLOTS: SlotRegistryEntry[] = [
  {
    slot_id: "week_synthesis",
    scope: "weekly",
    // Default: Sunday 22:00 local. Fires after the last daily day_synthesis lands.
    default_schedule: { local_time: "22:00" },
    ttl_ms: 7 * 24 * 60 * 60 * 1000,
    bump_events: [
      { event: "day_end", offset_ms: 30 * 60_000 },  // bump on Sunday's day_end
      { event: "manual", offset_ms: 0, recompute_on_bump: true },
    ],
    depends_on: [],                   // soft dep on 7 daily day_synthesis slots
    auto_schedule: true,
    fires_on_live_day: false,
    priority: 50,
    initial_status: "scheduled",
    slot_version: "week-synthesis/v1",
    model: "qwen3.6:latest",
  },
];

/**
 * Event slots: dynamic count per period. Scheduler does NOT pre-create
 * scheduled placeholders — the event handler appends a SlotEntry with
 * scheduled_for = event_ts + offset.
 */
export const EVENT_SLOTS: SlotRegistryEntry[] = [
  {
    slot_id: "post_workout",
    scope: "daily",
    default_schedule: { offset_after_event_ms: 5 * 60_000 },
    ttl_ms: 12 * 60 * 60 * 1000,
    bump_events: [
      { event: "workout_complete", offset_ms: 5 * 60_000 },
      { event: "manual", offset_ms: 0, recompute_on_bump: true },
    ],
    depends_on: [],                   // reads tier1 + plan, no prior slot
    auto_schedule: false,             // event-only
    fires_on_live_day: true,
    priority: 80,
    initial_status: "scheduled",
    slot_version: "post-workout/v1",
    model: "gpt-oss:20b",
  },
  {
    slot_id: "anomaly_explain",
    scope: "daily",
    default_schedule: { offset_after_event_ms: 0 },
    ttl_ms: 7 * 24 * 60 * 60 * 1000,
    bump_events: [
      { event: "manual", offset_ms: 0, recompute_on_bump: true },
    ],
    depends_on: [],
    auto_schedule: false,             // user-triggered only
    fires_on_live_day: true,
    priority: 75,
    initial_status: "scheduled",
    slot_version: "anomaly-explain/v1",
    model: "gpt-oss:20b",
  },
];

export const ALL_SLOTS: SlotRegistryEntry[] = [
  ...DAILY_SLOTS,
  ...WEEKLY_SLOTS,
  ...EVENT_SLOTS,
];

export function getSlotEntry(slot_id: SlotId): SlotRegistryEntry {
  const found = ALL_SLOTS.find((s) => s.slot_id === slot_id);
  if (!found) throw new Error(`Unknown slot_id: ${slot_id}`);
  return found;
}
