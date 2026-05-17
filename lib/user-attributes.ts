import "server-only";

import { db } from "./db";
import { pulseDb } from "./pulse-db";

/**
 * Phase 4 task #56 — effective user-attributes reader.
 *
 * Combines two sources, now living in two distinct files:
 *
 *  1. `USER_ATTRIBUTES` in **Gadgetbridge.db** — versioned by `VALID_FROM_UTC`
 *     / `VALID_TO_UTC`. The active row is the latest with `VALID_TO_UTC IS NULL`.
 *     Owned by Android Gadgetbridge — read-only from our side.
 *  2. `PULSE_USER_ATTRIBUTES` in **pulse.db** — Pulse-owned sidecar. Append-only,
 *     one row per edit. Only fields the user explicitly set are non-null.
 *     Latest non-null value per field wins.
 *
 * For each output field, PULSE wins when present, otherwise GB. The `source`
 * field is `"pulse_override"` if any field came from PULSE, else
 * `"gadgetbridge"`. `pulse_ts_iso` is the most recent `ts_iso` in
 * `PULSE_USER_ATTRIBUTES` (regardless of which fields were set), or `null`.
 *
 * Read-only — uses both readonly handles so it can be called from RSC.
 */

export interface EffectiveUserAttributes {
  height_cm: number | null;
  steps_goal_spd: number | null;
  sleep_goal_mpd: number | null;
  source: "gadgetbridge" | "pulse_override";
  pulse_ts_iso: string | null;
}

interface GBRow {
  HEIGHT_CM: number | null;
  STEPS_GOAL_SPD: number | null;
  SLEEP_GOAL_MPD: number | null;
}

interface PulseRow {
  height_cm: number | null;
  steps_goal_spd: number | null;
  sleep_goal_mpd: number | null;
  ts_iso: string | null;
}

export function readEffectiveUserAttributes(): EffectiveUserAttributes {
  const gbConn = db();

  const gb = gbConn
    .prepare<[], GBRow>(
      `SELECT HEIGHT_CM, STEPS_GOAL_SPD, SLEEP_GOAL_MPD
       FROM USER_ATTRIBUTES
       WHERE VALID_TO_UTC IS NULL
       ORDER BY VALID_FROM_UTC DESC
       LIMIT 1`,
    )
    .get();

  let pulse: PulseRow = {
    height_cm: null,
    steps_goal_spd: null,
    sleep_goal_mpd: null,
    ts_iso: null,
  };

  const pConn = pulseDb();
  if (pConn) {
    const hasPulseTable = pConn
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'PULSE_USER_ATTRIBUTES'`,
      )
      .get();

    if (hasPulseTable) {
      // One pass: pick the latest non-null value per column. SQLite has no
      // "last_value", but `(SELECT … ORDER BY ts_iso DESC LIMIT 1)` per column
      // is fine — the table is small and the ts_iso index covers the sort.
      const row = pConn
        .prepare<[], PulseRow>(
          `SELECT
             (SELECT height_cm FROM PULSE_USER_ATTRIBUTES
              WHERE height_cm IS NOT NULL ORDER BY ts_iso DESC LIMIT 1) AS height_cm,
             (SELECT steps_goal_spd FROM PULSE_USER_ATTRIBUTES
              WHERE steps_goal_spd IS NOT NULL ORDER BY ts_iso DESC LIMIT 1) AS steps_goal_spd,
             (SELECT sleep_goal_mpd FROM PULSE_USER_ATTRIBUTES
              WHERE sleep_goal_mpd IS NOT NULL ORDER BY ts_iso DESC LIMIT 1) AS sleep_goal_mpd,
             (SELECT ts_iso FROM PULSE_USER_ATTRIBUTES
              ORDER BY ts_iso DESC LIMIT 1) AS ts_iso`,
        )
        .get();
      if (row) pulse = row;
    }
  }

  const height =
    pulse.height_cm !== null ? pulse.height_cm : (gb?.HEIGHT_CM ?? null);
  const steps =
    pulse.steps_goal_spd !== null
      ? pulse.steps_goal_spd
      : (gb?.STEPS_GOAL_SPD ?? null);
  const sleep =
    pulse.sleep_goal_mpd !== null
      ? pulse.sleep_goal_mpd
      : (gb?.SLEEP_GOAL_MPD ?? null);

  const anyPulse =
    pulse.height_cm !== null ||
    pulse.steps_goal_spd !== null ||
    pulse.sleep_goal_mpd !== null;

  return {
    height_cm: height,
    steps_goal_spd: steps,
    sleep_goal_mpd: sleep,
    source: anyPulse ? "pulse_override" : "gadgetbridge",
    pulse_ts_iso: pulse.ts_iso,
  };
}
