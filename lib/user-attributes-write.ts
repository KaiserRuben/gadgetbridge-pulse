import "server-only";

import { getWritableDb } from "./db-writable";

/**
 * Phase 4 task #56 — write-back for user-attribute overrides.
 *
 * Append-only: each call inserts a new row into PULSE_USER_ATTRIBUTES with
 * only the patched fields set. The reader (`readEffectiveUserAttributes`)
 * picks up the latest non-null value per field, so partial patches stack.
 *
 * IMPORTANT: this writes ONLY to pulse.db. We do NOT touch the
 * `USER_ATTRIBUTES` table in Gadgetbridge.db, because:
 *   1. Android pushes its own values back on every export → our edits would
 *      be wiped on the next Syncthing sync.
 *   2. Gadgetbridge prefers SharedPreferences for these values anyway.
 *
 * Validation is server-side, in this module — never trust the client form.
 * Bounds chosen to match the Gadgetbridge UI's accepted ranges:
 *   - height_cm:        100..250
 *   - steps_goal_spd:   1000..50000
 *   - sleep_goal_mpd:   240..720  (4..12 hours)
 * NaN is rejected. Missing keys are fine (allows partial patches).
 */

export interface UserAttrPatch {
  height_cm?: number | null;
  steps_goal_spd?: number | null;
  sleep_goal_mpd?: number | null;
}

const HEIGHT_MIN = 100;
const HEIGHT_MAX = 250;
const STEPS_MIN = 1000;
const STEPS_MAX = 50000;
const SLEEP_MIN = 240;
const SLEEP_MAX = 720;

class UserAttrValidationError extends Error {}

function validateField(
  name: string,
  value: number | null | undefined,
  min: number,
  max: number,
  isInt: boolean,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new UserAttrValidationError(`${name}: not a finite number`);
  }
  if (isInt && !Number.isInteger(value)) {
    throw new UserAttrValidationError(`${name}: must be an integer`);
  }
  if (value < min || value > max) {
    throw new UserAttrValidationError(`${name}: out of range (${min}..${max})`);
  }
  return value;
}

export async function applyUserAttrPatch(
  patch: UserAttrPatch,
): Promise<{ ok: true; pulse_id: number }> {
  // Validate each present field. `undefined` means "not patched" → SQL NULL.
  const height = validateField("height_cm", patch.height_cm, HEIGHT_MIN, HEIGHT_MAX, false);
  const steps = validateField(
    "steps_goal_spd",
    patch.steps_goal_spd,
    STEPS_MIN,
    STEPS_MAX,
    true,
  );
  const sleep = validateField(
    "sleep_goal_mpd",
    patch.sleep_goal_mpd,
    SLEEP_MIN,
    SLEEP_MAX,
    true,
  );

  // Reject empty patches early — there's no point persisting a row of NULLs.
  if (height === undefined && steps === undefined && sleep === undefined) {
    throw new UserAttrValidationError("empty patch — at least one field required");
  }

  const conn = getWritableDb();
  const ts = new Date().toISOString();
  const stmt = conn.prepare<
    [string, number | null, number | null, number | null, string]
  >(
    `INSERT INTO PULSE_USER_ATTRIBUTES
       (ts_iso, height_cm, steps_goal_spd, sleep_goal_mpd, source)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    ts,
    height === undefined ? null : height,
    steps === undefined ? null : steps,
    sleep === undefined ? null : sleep,
    "user_input",
  );
  return { ok: true, pulse_id: Number(info.lastInsertRowid) };
}
