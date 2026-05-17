/**
 * User + device profile facts. No date-window — profile is stable.
 *
 * Returns the structurally simple `user` and `device` blocks defined by
 * `facts.schema.json`. `wear_seconds_24h` is computed against the day window
 * using 5-minute window-presence coverage: the 24-hour day is divided into
 * 288 windows of 300 seconds each; any window containing at least one valid
 * HR sample (31–219 bpm, forward-sentinel row only) counts as covered.
 *
 * Replaces the old density estimate (COUNT(*) × 60) which assumed one
 * row/minute — invalid for the Huawei GT 5 Pro's opportunistic polling model,
 * producing ~14–32% coverage on a fully-worn day and falsely triggering
 * data_quality_wear_low.
 */

import type Database from "better-sqlite3";
import type { DayWindow } from "../window.ts";

export interface BatteryAgg {
  min_pct: number | null;
  max_pct: number | null;
  mean_pct: number | null;
  samples: number;
  [k: string]: unknown | undefined;
}

export interface ProfileFactsRaw {
  user: {
    age: number | null;
    sex: "m" | "f" | "x" | null;
    height_cm: number | null;
  };
  device: {
    model: string | null;
    firmware: string | null;
    wear_seconds_24h: number | null;
    battery: BatteryAgg | null;
  };
  /** Weight from USER_ATTRIBUTES — used by body facts. */
  weight_kg: number | null;
  /** Step goal — used by activity facts (informational). */
  step_goal: number;
  /**
   * Encoded gap-window note for data_quality rule consumption.
   * Format: "wear_gaps:HH:MM-HH:MM[,HH:MM-HH:MM,...]" listing contiguous
   * uncovered spans ≥ 30 min relative to local midnight (window start).
   * Null when no significant gaps exist or wear data is absent.
   */
  wearGapNote: string | null;
}

interface UserRow {
  NAME: string | null;
  BIRTHDAY: number | null;
  GENDER: number | null;
}
interface UserAttrRow {
  HEIGHT_CM: number | null;
  WEIGHT_KG: number | null;
  STEPS_GOAL_SPD: number | null;
}
interface DeviceRow {
  NAME: string | null;
  MODEL: string | null;
}
interface DeviceAttrRow {
  FIRMWARE_VERSION1: string | null;
}
interface SlotRow {
  slot: number;
}

/** Minimum contiguous gap (in 5-min slots) worth surfacing in text_for_llm. */
const MIN_GAP_SLOTS = 6; // = 30 minutes

/**
 * Convert a 5-min slot index (0..287) to "HH:MM" relative to local midnight.
 * Slot 0 = 00:00, slot 72 = 06:00, slot 144 = 12:00, slot 287 = 23:55.
 */
function slotToHHMM(slot: number): string {
  const totalMin = slot * 5;
  const hh = Math.floor(totalMin / 60) % 24;
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Given the set of covered slot indices within [0, totalSlots), return all
 * contiguous uncovered runs ≥ MIN_GAP_SLOTS wide as "HH:MM-HH:MM" strings.
 */
function computeGapSpans(coveredSlots: Set<number>, totalSlots: number): string[] {
  const gaps: string[] = [];
  let gapStart: number | null = null;

  for (let i = 0; i < totalSlots; i++) {
    if (!coveredSlots.has(i)) {
      if (gapStart === null) gapStart = i;
    } else {
      if (gapStart !== null) {
        const len = i - gapStart;
        if (len >= MIN_GAP_SLOTS) {
          gaps.push(`${slotToHHMM(gapStart)}-${slotToHHMM(i)}`);
        }
        gapStart = null;
      }
    }
  }
  if (gapStart !== null) {
    const len = totalSlots - gapStart;
    if (len >= MIN_GAP_SLOTS) {
      gaps.push(`${slotToHHMM(gapStart)}-${slotToHHMM(totalSlots)}`);
    }
  }
  return gaps;
}

export function queryProfile(db: Database.Database, win: DayWindow): ProfileFactsRaw {
  const u = db
    .prepare<[], UserRow>(`SELECT NAME, BIRTHDAY, GENDER FROM USER LIMIT 1`)
    .get() ?? null;
  const ua = db
    .prepare<[], UserAttrRow>(
      `SELECT HEIGHT_CM, WEIGHT_KG, STEPS_GOAL_SPD
       FROM USER_ATTRIBUTES
       WHERE VALID_TO_UTC IS NULL
       ORDER BY VALID_FROM_UTC DESC LIMIT 1`,
    )
    .get() ?? null;
  const dev = db.prepare<[], DeviceRow>(`SELECT NAME, MODEL FROM DEVICE LIMIT 1`).get() ?? null;
  const fw = db
    .prepare<[], DeviceAttrRow>(
      `SELECT FIRMWARE_VERSION1 FROM DEVICE_ATTRIBUTES ORDER BY VALID_FROM_UTC DESC LIMIT 1`,
    )
    .get() ?? null;

  const startSec = win.startSec as number;
  const endSec = win.endSec as number;

  // Age at end-of-period, not at wall-clock now. Backfill correctness:
  // re-running 2024-01 facts should compute age as of 2024-01, not today.
  const ageYears = u?.BIRTHDAY
    ? (endSec * 1000 - u.BIRTHDAY) / (365.25 * 24 * 3600 * 1000)
    : null;
  const TOTAL_SLOTS = 288; // 24 h ÷ 5 min = 288 windows

  // ── Wear coverage: 5-minute window presence ──────────────────────────────
  // Count distinct 5-min slots containing ≥1 valid HR sample.
  // (TIMESTAMP - startSec) / 300 yields the slot index via SQLite integer
  // division; anchoring to startSec keeps alignment correct regardless of
  // whether startSec is a multiple of 300.
  // Sentinel filter OTHER_TIMESTAMP > TIMESTAMP excludes Huawei's duplicate
  // backward rows.
  const coverageRow = db
    .prepare<[number, number, number], { covered: number }>(
      `SELECT COUNT(DISTINCT ((TIMESTAMP - ?) / 300)) AS covered
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND HEART_RATE BETWEEN 31 AND 219
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(startSec, startSec, endSec);

  const coveredWindows = coverageRow?.covered ?? 0;
  const wearSeconds = coveredWindows > 0
    ? Math.min(86400, coveredWindows * 300)
    : null;

  // ── Gap detection (skip on near-perfect wear days) ───────────────────────
  let wearGapNote: string | null = null;
  if (coveredWindows > 0 && coveredWindows < TOTAL_SLOTS * 0.95) {
    const slotRows = db
      .prepare<[number, number, number], SlotRow>(
        `SELECT DISTINCT ((TIMESTAMP - ?) / 300) AS slot
         FROM HUAWEI_ACTIVITY_SAMPLE
         WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
           AND HEART_RATE BETWEEN 31 AND 219
           AND OTHER_TIMESTAMP > TIMESTAMP
         ORDER BY slot`,
      )
      .all(startSec, startSec, endSec);

    const coveredSet = new Set(slotRows.map((r) => r.slot));
    const gaps = computeGapSpans(coveredSet, TOTAL_SLOTS);
    if (gaps.length > 0) {
      wearGapNote = `wear_gaps:${gaps.join(",")}`;
    }
  }

  const sex: "m" | "f" | "x" | null =
    u?.GENDER === 1 ? "m" : u?.GENDER === 2 ? "f" : u?.GENDER === 0 ? null : "x";

  const battery = readBattery(db, startSec, endSec);

  return {
    user: {
      age: ageYears !== null && Number.isFinite(ageYears) ? Math.round(ageYears) : null,
      sex,
      height_cm: ua?.HEIGHT_CM ?? null,
    },
    device: {
      model: dev?.MODEL ?? dev?.NAME ?? null,
      firmware: fw?.FIRMWARE_VERSION1 ?? null,
      wear_seconds_24h: wearSeconds,
      battery,
    },
    weight_kg: ua?.WEIGHT_KG && ua.WEIGHT_KG > 0 ? ua.WEIGHT_KG : null,
    step_goal: ua?.STEPS_GOAL_SPD ?? 10000,
    wearGapNote,
  };
}

/**
 * BATTERY_LEVEL.TIMESTAMP is in UNIX SECONDS, LEVEL is 0..100. Returns nulls
 * when the table is missing or the window holds no rows.
 */
function readBattery(
  db: Database.Database,
  startSec: number,
  endSec: number,
): BatteryAgg | null {
  try {
    const row = db
      .prepare<
        [number, number],
        { mn: number | null; mx: number | null; avg: number | null; n: number }
      >(
        `SELECT MIN(LEVEL) AS mn, MAX(LEVEL) AS mx, AVG(LEVEL) AS avg, COUNT(*) AS n
         FROM BATTERY_LEVEL
         WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
           AND LEVEL BETWEEN 0 AND 100`,
      )
      .get(startSec, endSec);
    if (!row || row.n === 0) return null;
    return {
      min_pct: row.mn,
      max_pct: row.mx,
      mean_pct: row.avg !== null ? Math.round(row.avg * 10) / 10 : null,
      samples: row.n,
    };
  } catch (err) {
    console.warn(`[profile] battery read failed: ${(err as Error).message}`);
    return null;
  }
}
