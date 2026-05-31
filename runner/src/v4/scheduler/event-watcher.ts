/**
 * v4 event watcher — derives BumpEvents from Gadgetbridge.db deltas.
 *
 * Two signals:
 *   - sleep_complete  ← new HUAWEI_SLEEP_STATS_SAMPLE row past cursor
 *   - workout_complete ← new BASE_ACTIVITY_SUMMARY row past cursor
 *
 * Cursor state in `state/v4-event-cursor.json` survives daemon restarts
 * so the same wakeup/workout never fires twice. v4 cursor is a separate
 * file from v3 (`state/event-cursor.json`) so the pipelines can run
 * side-by-side during the migration; the v3 file gets deleted in
 * Phase 4.
 *
 * Pure: `scanForEvents()` returns a list of derived events + advances an
 * in-memory cursor. The caller decides when to persist via `saveCursor()`
 * and what to do with the events (typically: `daemon.applyBumpEvent()`).
 */

import type Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { config } from "../../config.ts";
import { localDateKey } from "../../period.ts";
import type { BumpEvent } from "../slots/_registry.ts";

export interface V4EventCursor {
  last_sleep_wakeup_ms: number;
  last_workout_end_ms: number;
}

const DEFAULT_CURSOR: V4EventCursor = {
  last_sleep_wakeup_ms: 0,
  last_workout_end_ms: 0,
};

const CURSOR_PATH = path.join(config.stateRoot, "v4-event-cursor.json");

export interface DerivedEvent {
  event: BumpEvent;
  period_key: string;
  /** Unix ms the row indicates (used to advance the cursor). */
  at_ms: number;
  payload?: Record<string, unknown>;
}

export function loadCursor(file: string = CURSOR_PATH): V4EventCursor {
  if (!existsSync(file)) return { ...DEFAULT_CURSOR };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<V4EventCursor>;
    return {
      last_sleep_wakeup_ms: raw.last_sleep_wakeup_ms ?? 0,
      last_workout_end_ms: raw.last_workout_end_ms ?? 0,
    };
  } catch {
    return { ...DEFAULT_CURSOR };
  }
}

export function saveCursor(c: V4EventCursor, file: string = CURSOR_PATH): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2), "utf8");
  renameSync(tmp, file);
}

interface SleepRow {
  BED_TIME: number;
  WAKEUP_TIME: number;
}

interface WorkoutRow {
  START_TIME: number;
  END_TIME: number;
  ACTIVITY_KIND: number;
}

/**
 * Scan the DB for new rows past `cursor`. Returns derived events and a
 * mutated cursor (in-memory). Callers should `saveCursor(next)` after
 * the events have been processed.
 *
 * Returns events in chronological order so the daemon can apply them
 * one at a time and re-fetch the view between bumps.
 */
export function scanForEvents(
  db: Database.Database,
  cursor: V4EventCursor,
): { events: DerivedEvent[]; next: V4EventCursor } {
  const next: V4EventCursor = { ...cursor };
  const events: DerivedEvent[] = [];

  try {
    const wake = db
      .prepare<[number], SleepRow>(
        `SELECT BED_TIME, WAKEUP_TIME
           FROM HUAWEI_SLEEP_STATS_SAMPLE
          WHERE WAKEUP_TIME > ?
          ORDER BY WAKEUP_TIME ASC`,
      )
      .all(cursor.last_sleep_wakeup_ms);
    for (const row of wake) {
      const periodKey = localDateKey(new Date(row.WAKEUP_TIME));
      events.push({
        event: "sleep_complete",
        period_key: periodKey,
        at_ms: row.WAKEUP_TIME,
        payload: {
          bedtime_iso: new Date(row.BED_TIME).toISOString(),
          wake_iso: new Date(row.WAKEUP_TIME).toISOString(),
        },
      });
      if (row.WAKEUP_TIME > next.last_sleep_wakeup_ms) {
        next.last_sleep_wakeup_ms = row.WAKEUP_TIME;
      }
    }
  } catch {
    // Table not present (test DBs) or unreadable — skip silently.
  }

  try {
    const wk = db
      .prepare<[number], WorkoutRow>(
        `SELECT START_TIME, END_TIME, ACTIVITY_KIND
           FROM BASE_ACTIVITY_SUMMARY
          WHERE END_TIME > ?
          ORDER BY END_TIME ASC`,
      )
      .all(cursor.last_workout_end_ms);
    for (const row of wk) {
      const periodKey = localDateKey(new Date(row.END_TIME));
      events.push({
        event: "workout_complete",
        period_key: periodKey,
        at_ms: row.END_TIME,
        payload: {
          start_iso: new Date(row.START_TIME).toISOString(),
          end_iso: new Date(row.END_TIME).toISOString(),
          kind: row.ACTIVITY_KIND,
          duration_min: Math.round((row.END_TIME - row.START_TIME) / 60_000),
        },
      });
      if (row.END_TIME > next.last_workout_end_ms) {
        next.last_workout_end_ms = row.END_TIME;
      }
    }
  } catch {
    // Same — table absent in test DBs.
  }

  events.sort((a, b) => a.at_ms - b.at_ms);
  return { events, next };
}
