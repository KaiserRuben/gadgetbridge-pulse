/**
 * Build an initial ViewState for a period. Called when no view-state
 * doc exists yet (cold start / new period). Tier1 fills with empty
 * values; slots populate with `scheduled` entries at their default
 * scheduled_for times.
 *
 * The scheduler then ticks and either fires slots (live day) or waits
 * for events (sleep_complete / workout_complete) to bump scheduled_for
 * forward.
 *
 * Phase 0: skeleton only. Tier1 fields zero-valued; will be backfilled
 * by tier1/refresher.ts the moment that lands in Phase 1.
 */

import {
  ALL_SLOTS,
  DAILY_SLOTS,
  EVENT_SLOTS,
  WEEKLY_SLOTS,
  type SlotRegistryEntry,
} from "../slots/_registry.ts";
import type {
  Scope,
  SlotEntry,
  Tier1,
  ViewState,
  ViewStateDaily,
  ViewStateMeta,
  ViewStateWeekly,
} from "../types.ts";

const TZ = "Europe/Berlin";

/**
 * Compute default scheduled_for for a slot, given the period's calendar
 * date (or week start). Uses the slot's default_schedule.local_time
 * interpreted in Europe/Berlin.
 *
 * If the slot has only an offset_after_event_ms (event slots), this
 * returns the period date at 00:00 local — the scheduler does not
 * pre-schedule event slots so this value is irrelevant for them.
 */
export function defaultScheduledFor(
  slot: SlotRegistryEntry,
  period_key: string,
  scope: Scope,
): string {
  if (slot.default_schedule.local_time && scope === "daily") {
    const [hh, mm] = slot.default_schedule.local_time.split(":").map(Number);
    return localToIso(period_key, hh, mm);
  }
  if (slot.default_schedule.local_time && scope === "weekly") {
    // Weekly default: Sunday of the ISO week at local_time
    const [hh, mm] = slot.default_schedule.local_time.split(":").map(Number);
    const sundayDate = isoWeekSunday(period_key);
    return localToIso(sundayDate, hh, mm);
  }
  // Fallback: period midnight local
  if (scope === "weekly") return localToIso(isoWeekSunday(period_key), 0, 0);
  return localToIso(period_key, 0, 0);
}

/**
 * Build an empty SlotEntry in `scheduled` state. Filled by worker on compute.
 */
function emptySlotEntry(
  slot: SlotRegistryEntry,
  period_key: string,
  scope: Scope,
): SlotEntry {
  return {
    slot_id: slot.slot_id,
    status: slot.initial_status,
    scheduled_for: defaultScheduledFor(slot, period_key, scope),
    ttl_ms: slot.ttl_ms,
    computed_at: null,
    computed_by: null,
    payload: null,
    inputs_used: null,
    error: null,
    degraded_reason: null,
    request_count: 0,
    version: 0,
  };
}

/**
 * Empty tier1. Real values land via tier1/refresher.ts (Phase 1).
 */
function emptyTier1(now: Date): Tier1 {
  return {
    computed_at: now.toISOString(),
    facts_now: {
      now_ms: now.getTime(),
      last_db_sample_at: null,
      data_lag_min: null,
      sleeping_in_progress: false,
      last_workout_end_at: null,
      hr_now: null,
    },
    kpis_today: {
      tst_min: null,
      sleep_eff_pct: null,
      rmssd_ms: null,
      rhr_sleep_bpm: null,
      rhr_day_bpm: null,
      steps: null,
      active_kcal: null,
      stress_mean: null,
      day_score: { value: null, band: null, reasoning: null },
      workouts: [],
    },
    kpis_14d: {
      sleep_quality_series: [],
      autonomic_balance_series: [],
      volume_load_series: [],
      day_score_series: [],
    },
    context: {
      day_of_week: dayOfWeek(now),
      is_weekend: isWeekendDay(now),
      plan_session_today: null,
      pain_flags_active: [],
      anomalies_today: [],
    },
  };
}

function emptyMeta(now: Date): ViewStateMeta {
  return {
    next_refresh_at: now.toISOString(),
    last_runner_heartbeat: now.toISOString(),
    last_phone_sync_at: null,
    pipeline_health: "ok",
    held_back: [],
  };
}

export function buildInitialDaily(period_key: string, now: Date = new Date()): ViewStateDaily {
  const slots = Object.fromEntries(
    DAILY_SLOTS.map((s) => [s.slot_id, emptySlotEntry(s, period_key, "daily")]),
  ) as unknown as ViewStateDaily["slots"];
  return {
    schema_version: "view/v1",
    period_key,
    scope: "daily",
    generated_at: now.toISOString(),
    tier1: emptyTier1(now),
    slots,
    events: { post_workout: [], anomaly_explain: [] },
    meta: emptyMeta(now),
    version: 0,
  };
}

export function buildInitialWeekly(period_key: string, now: Date = new Date()): ViewStateWeekly {
  const slots = Object.fromEntries(
    WEEKLY_SLOTS.map((s) => [s.slot_id, emptySlotEntry(s, period_key, "weekly")]),
  ) as unknown as ViewStateWeekly["slots"];
  return {
    schema_version: "view/v1",
    period_key,
    scope: "weekly",
    generated_at: now.toISOString(),
    tier1: emptyTier1(now),
    slots,
    events: { post_workout: [], anomaly_explain: [] },
    meta: emptyMeta(now),
    version: 0,
  };
}

export function buildInitial(period_key: string, scope: Scope, now: Date = new Date()): ViewState {
  return scope === "daily" ? buildInitialDaily(period_key, now) : buildInitialWeekly(period_key, now);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert YYYY-MM-DD + hh:mm Berlin-local → ISO UTC string. */
function localToIso(date_key: string, hh: number, mm: number): string {
  // Quick conversion: build a Date at UTC midnight for the calendar date, then
  // add the local-time component while compensating for the Berlin offset at
  // that instant. Acceptable for scheduling (rounds to minute).
  const [y, m, d] = date_key.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const localMs = utcMidnight + (hh * 60 + mm) * 60_000;
  const offsetMin = berlinOffsetMinutes(new Date(localMs));
  return new Date(localMs - offsetMin * 60_000).toISOString();
}

function berlinOffsetMinutes(at: Date): number {
  // Render the moment as Berlin civil and as UTC civil; diff = offset.
  const berlinParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(berlinParts.find((p) => p.type === t)?.value ?? "0");
  const civil = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second"),
  );
  return Math.round((civil - at.getTime()) / 60_000);
}

function dayOfWeek(at: Date): import("../types.ts").DayOfWeek {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(at).toLowerCase();
  return name.slice(0, 3) as import("../types.ts").DayOfWeek;
}

function isWeekendDay(at: Date): boolean {
  const dow = dayOfWeek(at);
  return dow === "sat" || dow === "sun";
}

function isoWeekSunday(week_key: string): string {
  // week_key = "YYYY-Www" — return YYYY-MM-DD of the Sunday of that ISO week.
  const m = /^(\d{4})-W(\d{2})$/.exec(week_key);
  if (!m) throw new Error(`Bad week_key: ${week_key}`);
  const isoYear = Number(m[1]);
  const isoWeek = Number(m[2]);
  // ISO week 1 contains the year's first Thursday. Anchor = Jan 4.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // Mon=1..Sun=7
  const weekStartMs = jan4.getTime() - (jan4Dow - 1) * 86_400_000 + (isoWeek - 1) * 7 * 86_400_000;
  const sundayMs = weekStartMs + 6 * 86_400_000;
  const dt = new Date(sundayMs);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
