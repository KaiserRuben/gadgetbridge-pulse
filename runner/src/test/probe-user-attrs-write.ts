/**
 * Smoke for #56 PULSE-only profile attrs write-back.
 *
 *   1. Read effective baseline (Gadgetbridge USER_ATTRIBUTES, no pulse rows yet).
 *   2. Insert patch { height_cm: 193, steps_goal_spd: 9000 }. Read effective.
 *      Assert override won, source = "pulse_override".
 *   3. Insert patch { sleep_goal_mpd: 480 }. Read again.
 *      Assert height + steps preserved, sleep set.
 *   4. Validation: NaN, out-of-range, non-int integers, empty patch — rejected.
 *
 * Runs as bare `tsx`, so we cannot import `lib/user-attributes-write.ts`
 * (carries `import "server-only"` which throws under Node). We inline the
 * equivalent DB calls — same SQL, same handle config, identical row layout.
 *
 * Run: `tsx runner/src/test/probe-user-attrs-write.ts`
 */

import Database from "better-sqlite3";

import { closeWritableDb, getWritableDb } from "../db-writable.ts";
import { runMigrations } from "../db-migrations.ts";
import { config } from "../config.ts";

interface UserAttrPatch {
  height_cm?: number | null;
  steps_goal_spd?: number | null;
  sleep_goal_mpd?: number | null;
}

interface CountRow {
  c: number;
}

interface GBRow {
  HEIGHT_CM: number | null;
  STEPS_GOAL_SPD: number | null;
  SLEEP_GOAL_MPD: number | null;
}

interface PulseAggRow {
  height_cm: number | null;
  steps_goal_spd: number | null;
  sleep_goal_mpd: number | null;
  ts_iso: string | null;
}

interface EffectiveAttrs {
  height_cm: number | null;
  steps_goal_spd: number | null;
  sleep_goal_mpd: number | null;
  source: "gadgetbridge" | "pulse_override";
  pulse_ts_iso: string | null;
}

const HEIGHT_MIN = 100;
const HEIGHT_MAX = 250;
const STEPS_MIN = 1000;
const STEPS_MAX = 50000;
const SLEEP_MIN = 240;
const SLEEP_MAX = 720;

class UserAttrValidationError extends Error {}

function validate(
  name: string,
  v: number | null | undefined,
  min: number,
  max: number,
  isInt: boolean,
): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "number" || Number.isNaN(v) || !Number.isFinite(v)) {
    throw new UserAttrValidationError(`${name}: not finite`);
  }
  if (isInt && !Number.isInteger(v)) {
    throw new UserAttrValidationError(`${name}: must be integer`);
  }
  if (v < min || v > max) {
    throw new UserAttrValidationError(`${name}: out of range`);
  }
  return v;
}

function applyUserAttrPatch(
  pulseDb: Database.Database,
  patch: UserAttrPatch,
): { ok: true; pulse_id: number } {
  const h = validate("height_cm", patch.height_cm, HEIGHT_MIN, HEIGHT_MAX, false);
  const s = validate("steps_goal_spd", patch.steps_goal_spd, STEPS_MIN, STEPS_MAX, true);
  const z = validate("sleep_goal_mpd", patch.sleep_goal_mpd, SLEEP_MIN, SLEEP_MAX, true);
  if (h === undefined && s === undefined && z === undefined) {
    throw new UserAttrValidationError("empty patch");
  }
  const ts = new Date().toISOString();
  const info = pulseDb
    .prepare<[string, number | null, number | null, number | null, string]>(
      `INSERT INTO PULSE_USER_ATTRIBUTES
         (ts_iso, height_cm, steps_goal_spd, sleep_goal_mpd, source)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      ts,
      h === undefined ? null : h,
      s === undefined ? null : s,
      z === undefined ? null : z,
      "user_input",
    );
  return { ok: true, pulse_id: Number(info.lastInsertRowid) };
}

function readEffective(pulseDb: Database.Database): EffectiveAttrs {
  // Open Gadgetbridge.db readonly for the GB-side row.
  const gbConn = new Database(config.dbPath, { readonly: true, fileMustExist: true });
  gbConn.pragma("query_only = ON");
  let gb: GBRow | undefined;
  try {
    gb = gbConn
      .prepare<[], GBRow>(
        `SELECT HEIGHT_CM, STEPS_GOAL_SPD, SLEEP_GOAL_MPD
         FROM USER_ATTRIBUTES
         WHERE VALID_TO_UTC IS NULL
         ORDER BY VALID_FROM_UTC DESC
         LIMIT 1`,
      )
      .get();
  } finally {
    gbConn.close();
  }

  const pulse = pulseDb
    .prepare<[], PulseAggRow>(
      `SELECT
         (SELECT height_cm FROM PULSE_USER_ATTRIBUTES
          WHERE height_cm IS NOT NULL ORDER BY ts_iso DESC LIMIT 1) AS height_cm,
         (SELECT steps_goal_spd FROM PULSE_USER_ATTRIBUTES
          WHERE steps_goal_spd IS NOT NULL ORDER BY ts_iso DESC LIMIT 1) AS steps_goal_spd,
         (SELECT sleep_goal_mpd FROM PULSE_USER_ATTRIBUTES
          WHERE sleep_goal_mpd IS NOT NULL ORDER BY ts_iso DESC LIMIT 1) AS sleep_goal_mpd,
         (SELECT ts_iso FROM PULSE_USER_ATTRIBUTES ORDER BY ts_iso DESC LIMIT 1) AS ts_iso`,
    )
    .get() ?? {
    height_cm: null,
    steps_goal_spd: null,
    sleep_goal_mpd: null,
    ts_iso: null,
  };

  const anyPulse =
    pulse.height_cm !== null ||
    pulse.steps_goal_spd !== null ||
    pulse.sleep_goal_mpd !== null;

  return {
    height_cm: pulse.height_cm !== null ? pulse.height_cm : (gb?.HEIGHT_CM ?? null),
    steps_goal_spd:
      pulse.steps_goal_spd !== null ? pulse.steps_goal_spd : (gb?.STEPS_GOAL_SPD ?? null),
    sleep_goal_mpd:
      pulse.sleep_goal_mpd !== null ? pulse.sleep_goal_mpd : (gb?.SLEEP_GOAL_MPD ?? null),
    source: anyPulse ? "pulse_override" : "gadgetbridge",
    pulse_ts_iso: pulse.ts_iso,
  };
}

function assertEq<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

function main(): void {
  const db = getWritableDb();
  runMigrations(db);

  const before = readEffective(db);
  console.log(`[probe] baseline:`, before);

  const r1 = applyUserAttrPatch(db, { height_cm: 193, steps_goal_spd: 9000 });
  console.log(`[probe] patch1 inserted pulse_id=${r1.pulse_id}`);

  const after1 = readEffective(db);
  console.log(`[probe] after patch1:`, after1);
  assertEq("after1.height_cm", after1.height_cm, 193);
  assertEq("after1.steps_goal_spd", after1.steps_goal_spd, 9000);
  assertEq("after1.source", after1.source, "pulse_override");

  const r2 = applyUserAttrPatch(db, { sleep_goal_mpd: 480 });
  console.log(`[probe] patch2 inserted pulse_id=${r2.pulse_id}`);

  const after2 = readEffective(db);
  console.log(`[probe] after patch2:`, after2);
  assertEq("after2.height_cm", after2.height_cm, 193);
  assertEq("after2.steps_goal_spd", after2.steps_goal_spd, 9000);
  assertEq("after2.sleep_goal_mpd", after2.sleep_goal_mpd, 480);
  assertEq("after2.source", after2.source, "pulse_override");

  let rejected = 0;
  for (const bad of [
    { height_cm: 50 },
    { height_cm: Number.NaN },
    { steps_goal_spd: 100 },
    { sleep_goal_mpd: 60 },
    { steps_goal_spd: 9000.5 },
    {} as UserAttrPatch,
  ]) {
    try {
      applyUserAttrPatch(db, bad);
    } catch {
      rejected += 1;
    }
  }
  assertEq("validation rejected count", rejected, 6);

  const c = db
    .prepare<[], CountRow>(`SELECT COUNT(*) AS c FROM PULSE_USER_ATTRIBUTES`)
    .get();
  console.log(`[probe] PULSE_USER_ATTRIBUTES rows: ${c?.c ?? 0}`);

  closeWritableDb();
  console.log(`[probe-user-attrs-write] OK`);
}

main();
