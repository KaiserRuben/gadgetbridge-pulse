/**
 * Dashboard mode engine — pure function.
 *
 * Inputs: now + most-recent events (workouts, wake, run completions).
 * Output: which DashboardMode to render. Drives section visibility, hero
 * focus, accent color and freshness emphasis.
 *
 * Priority (when multiple match):
 *   post-workout (within 90min) > all
 *   morning-fresh > morning-stale > midday
 *   late-night > evening
 *   day-incomplete (fallback)
 */

export type DashboardMode =
  | "night"
  | "morning-fresh"
  | "morning-stale"
  | "midday"
  | "post-workout"
  | "evening"
  | "late-night"
  | "day-incomplete";

export interface ModeInputs {
  /** Local time, milliseconds. */
  now_ms: number;
  /** IANA tz, e.g. "Europe/Berlin". */
  tz: string;
  /** Latest workout end time (ms). Null if none today. */
  last_workout_end_ms: number | null;
  /** Latest sleep_ended (wake) time (ms). Null if not woken yet today. */
  last_wake_ms: number | null;
  /** Whether sleep insight has been written today. */
  sleep_insight_ready: boolean;
  /** Whether synthesis (daily_v3) has been written today. */
  synthesis_ready: boolean;
  /** Whether today's daily_v3.json is flagged `incomplete: false`. */
  day_complete: boolean;
  /** Whether a v3 run is currently in progress (any insight written today but not all). */
  run_in_progress: boolean;
}

export interface ModeResult {
  mode: DashboardMode;
  /** Why we chose this mode — surfaces in dev tools / debug panel. */
  reasoning: string;
}

const POST_WORKOUT_WINDOW_MS = 90 * 60 * 1000;
const MORNING_WINDOW_AFTER_WAKE_MS = 2 * 60 * 60 * 1000;

export function computeMode(inputs: ModeInputs): ModeResult {
  const localHour = hourInTz(inputs.now_ms, inputs.tz);
  const minSinceWorkout = inputs.last_workout_end_ms
    ? inputs.now_ms - inputs.last_workout_end_ms
    : null;
  const minSinceWake = inputs.last_wake_ms ? inputs.now_ms - inputs.last_wake_ms : null;

  // 1. Post-workout always wins (within 90min of last workout end).
  if (minSinceWorkout != null && minSinceWorkout <= POST_WORKOUT_WINDOW_MS) {
    return {
      mode: "post-workout",
      reasoning: `workout ended ${Math.round(minSinceWorkout / 60_000)}min ago (within 90min window)`,
    };
  }

  // 2. Night (00:00–06:00) — quiet mode.
  if (localHour < 6) {
    return {
      mode: "night",
      reasoning: `local hour ${localHour} is in night window (<06:00)`,
    };
  }

  // 3. Late-night (22:00–24:00) — wind-down.
  if (localHour >= 22) {
    return {
      mode: "late-night",
      reasoning: `local hour ${localHour} is in late-night window (≥22:00)`,
    };
  }

  // 4. Morning window (06:00–11:00 + within 2h of wake).
  if (
    localHour < 11 &&
    minSinceWake != null &&
    minSinceWake <= MORNING_WINDOW_AFTER_WAKE_MS
  ) {
    if (inputs.sleep_insight_ready) {
      return {
        mode: "morning-fresh",
        reasoning: `woke ${Math.round(minSinceWake / 60_000)}min ago, sleep insight ready`,
      };
    }
    return {
      mode: "morning-stale",
      reasoning: `woke ${Math.round(minSinceWake / 60_000)}min ago, sleep insight pending${inputs.run_in_progress ? " (run in progress)" : ""}`,
    };
  }

  // 5. Evening (18:00–22:00).
  if (localHour >= 18) {
    if (inputs.synthesis_ready) {
      return {
        mode: "evening",
        reasoning: `local hour ${localHour}, synthesis ready`,
      };
    }
    return {
      mode: "day-incomplete",
      reasoning: `local hour ${localHour} (evening), synthesis NOT ready — fallback to incomplete view`,
    };
  }

  // 6. Midday (11:00–18:00).
  if (localHour >= 11 && localHour < 18) {
    return {
      mode: "midday",
      reasoning: `local hour ${localHour} is midday window`,
    };
  }

  // 7. Fallback.
  return {
    mode: "day-incomplete",
    reasoning: `no mode matched — fallback`,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hourInTz(ms: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

/** UI accent color token per mode. Dashboard uses these to tint hero + animations. */
export const MODE_ACCENT: Record<DashboardMode, string> = {
  night: "indigo-500",
  "morning-fresh": "amber-400",
  "morning-stale": "amber-300",
  midday: "sky-400",
  "post-workout": "orange-500",
  evening: "violet-400",
  "late-night": "indigo-400",
  "day-incomplete": "neutral-400",
};

/** Human-readable mode label for the top-of-page mode banner. */
export const MODE_LABEL_DE: Record<DashboardMode, string> = {
  night: "NACHT",
  "morning-fresh": "MORGEN",
  "morning-stale": "MORGEN · ANALYSE LÄUFT",
  midday: "MITTAG",
  "post-workout": "NACH TRAINING",
  evening: "ABEND",
  "late-night": "SPÄTABEND",
  "day-incomplete": "TAG OFFEN",
};
