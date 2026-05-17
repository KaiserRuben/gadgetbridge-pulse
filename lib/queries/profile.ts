import "server-only";
import { db } from "../db";
import type { DeviceInfo, UserProfile } from "../types";

export function getUser(): UserProfile {
  const u = db()
    .prepare<
      [],
      { NAME: string; BIRTHDAY: number; GENDER: number }
    >(
      `SELECT NAME, BIRTHDAY, GENDER FROM USER LIMIT 1`,
    )
    .get();
  if (!u) throw new Error("USER row missing");

  const a = db()
    .prepare<
      [],
      {
        HEIGHT_CM: number;
        WEIGHT_KG: number;
        STEPS_GOAL_SPD: number;
        SLEEP_GOAL_MPD: number;
      }
    >(
      `SELECT HEIGHT_CM, WEIGHT_KG, STEPS_GOAL_SPD, SLEEP_GOAL_MPD
       FROM USER_ATTRIBUTES
       WHERE VALID_TO_UTC IS NULL
       ORDER BY VALID_FROM_UTC DESC LIMIT 1`,
    )
    .get();

  const ageYears = u.BIRTHDAY ? (Date.now() - u.BIRTHDAY) / (365.25 * 24 * 3600 * 1000) : 0;

  return {
    name: u.NAME,
    gender: u.GENDER,
    birthdayMs: u.BIRTHDAY,
    ageYears,
    heightCm: a?.HEIGHT_CM ?? 0,
    weightKg: a?.WEIGHT_KG ?? 0,
    stepGoal: a?.STEPS_GOAL_SPD ?? 10000,
    sleepGoalMin: a?.SLEEP_GOAL_MPD ?? 480,
  };
}

export function getDevice(): DeviceInfo {
  const d = db()
    .prepare<
      [],
      {
        NAME: string;
        MANUFACTURER: string;
        MODEL: string;
        IDENTIFIER: string;
      }
    >(
      `SELECT NAME, MANUFACTURER, MODEL, IDENTIFIER FROM DEVICE LIMIT 1`,
    )
    .get();
  if (!d) throw new Error("DEVICE row missing");

  const a = db()
    .prepare<
      [],
      { FIRMWARE_VERSION1: string; VALID_FROM_UTC: number }
    >(
      `SELECT FIRMWARE_VERSION1, VALID_FROM_UTC FROM DEVICE_ATTRIBUTES ORDER BY VALID_FROM_UTC ASC LIMIT 1`,
    )
    .get();

  return {
    name: d.NAME,
    manufacturer: d.MANUFACTURER,
    model: d.MODEL,
    identifier: d.IDENTIFIER,
    firmware: a?.FIRMWARE_VERSION1 ?? "?",
    pairedAt: a?.VALID_FROM_UTC ? Math.floor(a.VALID_FROM_UTC / 1000) : 0,
  };
}

export function getAlarms() {
  return db()
    .prepare<
      [],
      { POSITION: number; ENABLED: number; HOUR: number; MINUTE: number; REPETITION: number }
    >(
      `SELECT POSITION, ENABLED, HOUR, MINUTE, REPETITION FROM ALARM ORDER BY POSITION`,
    )
    .all();
}

export function getCalendarSyncCount(): number {
  return (
    db()
      .prepare<[], { c: number }>(
        `SELECT COUNT(*) AS c FROM CALENDAR_SYNC_STATE`,
      )
      .get()?.c ?? 0
  );
}

/**
 * Calendar sync entries. Gadgetbridge stores only an opaque ID + content hash
 * per Android calendar event — no titles. This is a sync log, not a calendar
 * snapshot.
 */
export function getCalendarSyncEntries() {
  return db()
    .prepare<
      [],
      {
        CALENDAR_ENTRY_ID: number;
        HASH: number;
      }
    >(
      `SELECT CALENDAR_ENTRY_ID, HASH FROM CALENDAR_SYNC_STATE ORDER BY CALENDAR_ENTRY_ID`,
    )
    .all();
}
