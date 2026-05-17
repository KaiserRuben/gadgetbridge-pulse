/**
 * Smart trigger detector — polled from runner watch process.
 *
 * Watches Gadgetbridge.db for two events:
 *   1. Post-workout: new BASE_ACTIVITY_SUMMARY row whose END_TIME exceeds the
 *      last-seen workout end time.
 *   2. Morning wake: new HUAWEI_SLEEP_STATS_SAMPLE row whose WAKEUP_TIME is on
 *      today's local date and exceeds last-seen wake time.
 *
 * On detection, returns the trigger info for the caller to act on (run v3,
 * dispatch push, etc.). Persisted state in ${STATE_ROOT}/triggers.json so
 * detection is durable across restarts.
 */

import type Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

export interface TriggerState {
  last_workout_end_ms: number;
  last_wake_ms: number;
  last_evening_run_date: string | null;
}

export interface DetectedTrigger {
  kind: "post_workout" | "morning_wake" | "evening_brief";
  date: string;
  payload: Record<string, unknown>;
}

const DEFAULT_STATE: TriggerState = {
  last_workout_end_ms: 0,
  last_wake_ms: 0,
  last_evening_run_date: null,
};

export interface TriggerOpts {
  db: Database.Database;
  stateRoot: string;
  /** Local timezone for date keys + evening cron windowing. */
  tz?: string;
  /** Hour for evening cron (default 21 = 9pm local). */
  eveningHour?: number;
}

export function detectTriggers(opts: TriggerOpts): DetectedTrigger[] {
  const tz = opts.tz ?? "Europe/Berlin";
  const eveningHour = opts.eveningHour ?? 21;
  const state = loadState(opts.stateRoot);
  const out: DetectedTrigger[] = [];

  // ── 1. Post-workout ────────────────────────────────────────────────────
  try {
    const workout = opts.db
      .prepare<[number], { START_TIME: number; END_TIME: number; ACTIVITY_KIND: number }>(
        `SELECT START_TIME, END_TIME, ACTIVITY_KIND
         FROM BASE_ACTIVITY_SUMMARY
         WHERE END_TIME > ?
         ORDER BY END_TIME DESC LIMIT 1`,
      )
      .get(state.last_workout_end_ms);
    if (workout && workout.END_TIME > state.last_workout_end_ms) {
      out.push({
        kind: "post_workout",
        date: localDateKey(workout.END_TIME, tz),
        payload: {
          start_iso: new Date(workout.START_TIME).toISOString(),
          end_iso: new Date(workout.END_TIME).toISOString(),
          kind: workout.ACTIVITY_KIND,
          duration_min: Math.round((workout.END_TIME - workout.START_TIME) / 60_000),
        },
      });
      state.last_workout_end_ms = workout.END_TIME;
    }
  } catch (err) {
    console.warn(`[triggers] post-workout detection failed: ${(err as Error).message}`);
  }

  // ── 2. Morning wake ────────────────────────────────────────────────────
  try {
    const wake = opts.db
      .prepare<[number], { BED_TIME: number; WAKEUP_TIME: number }>(
        `SELECT BED_TIME, WAKEUP_TIME
         FROM HUAWEI_SLEEP_STATS_SAMPLE
         WHERE WAKEUP_TIME > ?
         ORDER BY WAKEUP_TIME DESC LIMIT 1`,
      )
      .get(state.last_wake_ms);
    if (wake && wake.WAKEUP_TIME > state.last_wake_ms) {
      out.push({
        kind: "morning_wake",
        date: localDateKey(wake.WAKEUP_TIME, tz),
        payload: {
          bedtime_iso: new Date(wake.BED_TIME).toISOString(),
          wake_iso: new Date(wake.WAKEUP_TIME).toISOString(),
        },
      });
      state.last_wake_ms = wake.WAKEUP_TIME;
    }
  } catch (err) {
    console.warn(`[triggers] morning-wake detection failed: ${(err as Error).message}`);
  }

  // ── 3. Evening brief (once per local day, post 21:00) ──────────────────
  const now = Date.now();
  const localHour = hourInTz(now, tz);
  const todayKey = localDateKey(now, tz);
  if (
    localHour >= eveningHour &&
    state.last_evening_run_date !== todayKey
  ) {
    out.push({
      kind: "evening_brief",
      date: todayKey,
      payload: { hour: localHour },
    });
    state.last_evening_run_date = todayKey;
  }

  saveState(opts.stateRoot, state);
  return out;
}

// ── State persistence ────────────────────────────────────────────────────────

function statePath(stateRoot: string): string {
  return path.join(stateRoot, "triggers.json");
}

function loadState(stateRoot: string): TriggerState {
  const p = statePath(stateRoot);
  if (!existsSync(p)) return { ...DEFAULT_STATE };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<TriggerState>;
    return {
      last_workout_end_ms: raw.last_workout_end_ms ?? 0,
      last_wake_ms: raw.last_wake_ms ?? 0,
      last_evening_run_date: raw.last_evening_run_date ?? null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(stateRoot: string, state: TriggerState): void {
  const dir = stateRoot;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = statePath(dir);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, target);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hourInTz(ms: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  });
  return Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === "hour")?.value ?? "0");
}

function localDateKey(ms: number, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ms));
}
