/**
 * Event sources — translate raw DB / time signals into bus events.
 *
 * Cursor state in `state/event-cursor.json` survives restarts so we never
 * double-fire a sleep_complete for the same wakeup.
 */

import type Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

import { config } from "../config.ts";
import { log } from "../logger.ts";
import { isDailyFinalised, isDayComplete, isV3Finalised, localDateKey } from "../period.ts";
import { bus } from "./bus.ts";

export interface EventCursor {
  last_sleep_wakeup_ms: number;
  last_workout_end_ms: number;
  last_day_end_period: string | null;
}

const DEFAULT_CURSOR: EventCursor = {
  last_sleep_wakeup_ms: 0,
  last_workout_end_ms: 0,
  last_day_end_period: null,
};

const CURSOR_PATH = path.join(config.stateRoot, "event-cursor.json");

export function loadCursor(): EventCursor {
  if (!existsSync(CURSOR_PATH)) return { ...DEFAULT_CURSOR };
  try {
    const raw = JSON.parse(readFileSync(CURSOR_PATH, "utf8")) as Partial<EventCursor>;
    return {
      last_sleep_wakeup_ms: raw.last_sleep_wakeup_ms ?? 0,
      last_workout_end_ms: raw.last_workout_end_ms ?? 0,
      last_day_end_period: raw.last_day_end_period ?? null,
    };
  } catch {
    return { ...DEFAULT_CURSOR };
  }
}

export function saveCursor(c: EventCursor): void {
  if (!existsSync(config.stateRoot)) mkdirSync(config.stateRoot, { recursive: true });
  const tmp = `${CURSOR_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2), "utf8");
  renameSync(tmp, CURSOR_PATH);
}

/**
 * Scan the DB for new sleep / workout rows past the cursor. Emits one event
 * per new row and advances the cursor.
 */
export async function emitDbEvents(db: Database.Database): Promise<void> {
  const c = loadCursor();
  let dirty = false;

  // Sleep — new HUAWEI_SLEEP_STATS_SAMPLE row past cursor.
  try {
    const wake = db
      .prepare<[number], { BED_TIME: number; WAKEUP_TIME: number }>(
        `SELECT BED_TIME, WAKEUP_TIME
         FROM HUAWEI_SLEEP_STATS_SAMPLE
         WHERE WAKEUP_TIME > ?
         ORDER BY WAKEUP_TIME DESC LIMIT 1`,
      )
      .get(c.last_sleep_wakeup_ms);
    if (wake && wake.WAKEUP_TIME > c.last_sleep_wakeup_ms) {
      const periodKey = localDateKey(new Date(wake.WAKEUP_TIME));
      await bus.emit("sleep_complete", periodKey, {
        bedtime_iso: new Date(wake.BED_TIME).toISOString(),
        wake_iso: new Date(wake.WAKEUP_TIME).toISOString(),
      }, wake.WAKEUP_TIME);
      c.last_sleep_wakeup_ms = wake.WAKEUP_TIME;
      dirty = true;
    }
  } catch (err) {
    log.warn("sources", `sleep_complete detection failed: ${(err as Error).message}`);
  }

  // Workout — new BASE_ACTIVITY_SUMMARY row past cursor.
  try {
    const w = db
      .prepare<[number], { START_TIME: number; END_TIME: number; ACTIVITY_KIND: number }>(
        `SELECT START_TIME, END_TIME, ACTIVITY_KIND
         FROM BASE_ACTIVITY_SUMMARY
         WHERE END_TIME > ?
         ORDER BY END_TIME DESC LIMIT 1`,
      )
      .get(c.last_workout_end_ms);
    if (w && w.END_TIME > c.last_workout_end_ms) {
      const periodKey = localDateKey(new Date(w.END_TIME));
      await bus.emit("workout_complete", periodKey, {
        start_iso: new Date(w.START_TIME).toISOString(),
        end_iso: new Date(w.END_TIME).toISOString(),
        kind: w.ACTIVITY_KIND,
        duration_min: Math.round((w.END_TIME - w.START_TIME) / 60_000),
      }, w.END_TIME);
      c.last_workout_end_ms = w.END_TIME;
      dirty = true;
    }
  } catch (err) {
    log.warn("sources", `workout_complete detection failed: ${(err as Error).message}`);
  }

  if (dirty) saveCursor(c);
}

/**
 * Emit day_end for any past day that is complete (per the wake-date gate) but
 * has neither a sentinel nor a previously-emitted day_end. Called on boot and
 * on the hourly tick. Bounded by `lookbackDays` so a fresh deploy doesn't
 * stampede the GPU with 30 days of history.
 */
export async function emitDayEndBacklog(
  lookbackDays: number,
  today: string,
): Promise<void> {
  const dates = pastDateRange(today, lookbackDays);
  const c = loadCursor();
  for (const periodKey of dates) {
    if (!isDayComplete(periodKey)) continue;
    // Re-emit until both v2 + v3 are finalised. Handler is idempotent per
    // stage (subscribers.ts skips whichever sentinel is already present).
    if (isDailyFinalised(periodKey) && isV3Finalised(periodKey)) continue;
    if (c.last_day_end_period && periodKey <= c.last_day_end_period && periodKey !== today) {
      // already moved past; still emit if pipeline incomplete — handler dedupes per stage
    }
    // Use a fresh ts per sweep so the bus id differs from prior emits. The
    // handler is idempotent (sentinels) so duplicates are safe; what we want
    // to avoid is the bus suppressing the retry because a stale id was logged.
    await bus.emit("day_end", periodKey, { source: "backlog" }, Date.now());
  }
  // Advance cursor to today (mark "we've considered up to today"). Sentinel
  // remains the source of truth for whether work is actually done.
  if (!c.last_day_end_period || today > c.last_day_end_period) {
    c.last_day_end_period = today;
    saveCursor(c);
  }
}

function pastDateRange(today: string, n: number): string[] {
  const out: string[] = [];
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  for (let i = n; i >= 1; i--) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() - i);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return out;
}
