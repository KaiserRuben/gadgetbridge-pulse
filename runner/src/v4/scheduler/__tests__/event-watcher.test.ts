import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadCursor,
  saveCursor,
  scanForEvents,
} from "../event-watcher.ts";
import type Database from "better-sqlite3";

let tmp: string;
let cursorFile: string;

// Hand-rolled fake covering just what scanForEvents uses: db.prepare(sql).all(arg).
interface SleepRow { BED_TIME: number; WAKEUP_TIME: number }
interface WkRow { START_TIME: number; END_TIME: number; ACTIVITY_KIND: number }

function makeDb(opts: {
  sleep?: SleepRow[];
  workouts?: WkRow[];
  throwOnSleep?: boolean;
  throwOnWorkout?: boolean;
}): Database.Database {
  const sleep = opts.sleep ?? [];
  const wks = opts.workouts ?? [];
  return {
    prepare(sql: string) {
      const isSleep = sql.includes("HUAWEI_SLEEP_STATS_SAMPLE");
      const isWk = sql.includes("BASE_ACTIVITY_SUMMARY");
      return {
        all(cursor: number) {
          if (isSleep) {
            if (opts.throwOnSleep) throw new Error("missing table");
            return sleep
              .filter((r) => r.WAKEUP_TIME > cursor)
              .sort((a, b) => a.WAKEUP_TIME - b.WAKEUP_TIME);
          }
          if (isWk) {
            if (opts.throwOnWorkout) throw new Error("missing table");
            return wks
              .filter((r) => r.END_TIME > cursor)
              .sort((a, b) => a.END_TIME - b.END_TIME);
          }
          return [];
        },
        get() {
          return null;
        },
      };
    },
  } as unknown as Database.Database;
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "pulse-v4-evtwatch-"));
  cursorFile = path.join(tmp, "v4-event-cursor.json");
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("v4 event-watcher", () => {
  it("yields sleep_complete + workout_complete on fresh cursor", () => {
    const bed = new Date("2026-05-27T00:30:00+02:00").getTime();
    const wake = new Date("2026-05-27T07:30:00+02:00").getTime();
    const wkStart = new Date("2026-05-27T18:00:00+02:00").getTime();
    const wkEnd = new Date("2026-05-27T18:45:00+02:00").getTime();

    const db = makeDb({
      sleep: [{ BED_TIME: bed, WAKEUP_TIME: wake }],
      workouts: [{ START_TIME: wkStart, END_TIME: wkEnd, ACTIVITY_KIND: 1 }],
    });

    const cursor = loadCursor(cursorFile);
    const { events, next } = scanForEvents(db, cursor);

    expect(events).toHaveLength(2);
    const kinds = events.map((e) => e.event);
    expect(kinds).toContain("sleep_complete");
    expect(kinds).toContain("workout_complete");
    expect(events[0].at_ms).toBeLessThan(events[1].at_ms);
    expect(events[0].period_key).toBe("2026-05-27");

    expect(next.last_sleep_wakeup_ms).toBe(wake);
    expect(next.last_workout_end_ms).toBe(wkEnd);

    saveCursor(next, cursorFile);
  });

  it("returns no events when cursor is current", () => {
    const cursor = loadCursor(cursorFile);
    const db = makeDb({
      sleep: [{ BED_TIME: 0, WAKEUP_TIME: cursor.last_sleep_wakeup_ms }],
      workouts: [{ START_TIME: 0, END_TIME: cursor.last_workout_end_ms, ACTIVITY_KIND: 1 }],
    });
    const { events } = scanForEvents(db, cursor);
    expect(events).toHaveLength(0);
  });

  it("picks up only rows past cursor when a later wakeup lands", () => {
    const cursor = loadCursor(cursorFile);
    const wake2 = new Date("2026-05-28T07:00:00+02:00").getTime();
    const db = makeDb({
      sleep: [
        { BED_TIME: 0, WAKEUP_TIME: cursor.last_sleep_wakeup_ms },
        { BED_TIME: wake2 - 7 * 3600_000, WAKEUP_TIME: wake2 },
      ],
    });

    const { events, next } = scanForEvents(db, cursor);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("sleep_complete");
    expect(events[0].period_key).toBe("2026-05-28");
    expect(next.last_sleep_wakeup_ms).toBe(wake2);
  });

  it("survives missing tables", () => {
    const db = makeDb({ throwOnSleep: true, throwOnWorkout: true });
    const { events, next } = scanForEvents(db, loadCursor(cursorFile));
    expect(events).toHaveLength(0);
    expect(next.last_sleep_wakeup_ms).toBeGreaterThanOrEqual(0);
  });
});
