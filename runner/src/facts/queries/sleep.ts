/**
 * Date-windowed sleep facts.
 *
 * Returns the structurally simple metric block defined by `facts.schema.json`.
 * No baselines, no signal-quality logic — those are computed separately.
 *
 * Notes:
 *   - HUAWEI_SLEEP_STATS_SAMPLE.TIMESTAMP is in milliseconds.
 *   - We pick the latest stats row whose WAKEUP_TIME falls inside the window.
 *     (Wake-date semantics — a sleep block belongs to the day it ended on.)
 *   - HUAWEI_SLEEP_STAGE_SAMPLE.TIMESTAMP is in milliseconds. Each row is one
 *     minute of stage data. We sum minutes per stage code (1=light, 2=rem,
 *     3=deep, 4=awake).
 */

import type Database from "better-sqlite3";
import type { Ms } from "@/lib/types/branded";
import type { DayWindow } from "../window.ts";

export interface SleepFactsRaw {
  metrics: {
    tst_min: number | null;
    sleep_efficiency_pct: number | null;
    rem_min: number | null;
    deep_min: number | null;
    light_min: number | null;
    awake_min: number | null;
    rhr_sleep_bpm: number | null;
    rmssd_ms: number | null;
    spo2_min_pct: number | null;
    breath_rate_mean: number | null;
    wake_count: number | null;
    rdi: number | null;
    hr_min_sleep: number | null;
    hr_max_sleep: number | null;
    /** Mean sleeping HR from device (always populated on Huawei). */
    hr_avg_sleep: number | null;
    /** Native device 0..100 sleep score (Huawei). */
    sleep_score: number | null;
    sleep_latency_min: number | null;
    apnea_events_count: number | null;
    apnea_max_level: number | null;
    /** Bedtime in minutes from local midnight (Europe/Berlin). 0..1439. May be >1440 for past-midnight. */
    bedtime_min: number | null;
    /** Wakeup time in minutes from local midnight. */
    wakeup_min: number | null;
  };
  rowCount: number;
  /** Total in-bed minutes (TIB) — used by signal-quality. */
  tibMin: number | null;
  /** Coverage percentage 0..100 — minutes of stage data / TIB. */
  coveragePct: number | null;
}

interface SleepStatsRow {
  SLEEP_SCORE: number | null;
  BED_TIME: number | null;
  WAKEUP_TIME: number | null;
  SLEEP_EFFICIENCY: number | null;
  AVG_HRV: number | null;
  AVG_HEART_RATE: number | null;
  AVG_OXYGEN_SATURATION: number | null;
  MIN_HEART_RATE: number | null;
  MAX_HEART_RATE: number | null;
  AVG_BREATH_RATE: number | null;
  WAKE_COUNT: number | null;
  RDI: number | null;
  SLEEP_LATENCY: number | null;
}

interface ApneaAggRow {
  n: number;
  max_level: number | null;
}

interface StageAggRow {
  stage: number;
  mins: number;
}

const STAGE_LIGHT = 1;
const STAGE_REM = 2;
const STAGE_DEEP = 3;
const STAGE_AWAKE = 4;

/** Pull sleep facts for the given window. Returns a fully populated metric block. */
export function querySleep(db: Database.Database, win: DayWindow): SleepFactsRaw {
  const stats = readStats(db, win);

  // Stage minutes: each row = 1 minute. We accept both the wake-date wakeup
  // window (BED_TIME may sit before window.start) and the daytime window;
  // for daily facts we filter by the stages whose timestamp falls inside the
  // [start, end) window AND inside the night just ended.
  // Huawei writes BED_TIME=0 or -1 as a sentinel when missing — `??` lets those
  // through and explodes the lower bound to epoch 0, sweeping every stage row
  // ever recorded into the aggregate.
  const rawBedMs = stats?.BED_TIME ?? null;
  const rawWakeMs = stats?.WAKEUP_TIME ?? null;
  const sleepStartMs = rawBedMs && rawBedMs > 0 ? rawBedMs : (win.startMs as number);
  const sleepEndMs = rawWakeMs && rawWakeMs > 0 ? rawWakeMs : (win.endMs as number);
  const naiveStart = sleepStartMs < sleepEndMs ? sleepStartMs : (win.startMs as number);
  // Clamp to ≤18h before wakeup. A single night never exceeds that, but a
  // missing/zero BED_TIME would otherwise let the query span days.
  const maxNightMs = 18 * 3600 * 1000;
  const stagesMs = Math.max(naiveStart, sleepEndMs - maxNightMs);
  const stagesMe = sleepEndMs > stagesMs ? sleepEndMs : (win.endMs as number);

  const stageRows = db
    .prepare<
      [number, number],
      StageAggRow
    >(
      `SELECT STAGE AS stage, COUNT(*) AS mins
       FROM HUAWEI_SLEEP_STAGE_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
       GROUP BY STAGE`,
    )
    .all(stagesMs, stagesMe);

  const stageMap: Record<number, number> = {};
  for (const r of stageRows) stageMap[r.stage] = r.mins;
  const lightMin = stageMap[STAGE_LIGHT] ?? 0;
  const remMin = stageMap[STAGE_REM] ?? 0;
  const deepMin = stageMap[STAGE_DEEP] ?? 0;
  const awakeMin = stageMap[STAGE_AWAKE] ?? 0;
  const totalStageMin = lightMin + remMin + deepMin + awakeMin;
  const tstMin = lightMin + remMin + deepMin; // exclude awake from TST
  const tibMin =
    rawBedMs && rawBedMs > 0 && rawWakeMs && rawWakeMs > rawBedMs
      ? Math.round((rawWakeMs - rawBedMs) / 60000)
      : totalStageMin > 0
        ? totalStageMin
        : null;
  const coveragePct =
    tibMin && tibMin > 0 ? Math.round((totalStageMin / tibMin) * 100) : null;

  // Min SpO2 during the night: pull from activity table because Huawei stats
  // only carries average. We accept the in-bed window.
  const spo2 = db
    .prepare<[number, number], { min_spo: number | null }>(
      `SELECT MIN(SPO) AS min_spo
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND SPO BETWEEN 50 AND 100
         AND OTHER_TIMESTAMP > TIMESTAMP`,
    )
    .get(Math.floor(stagesMs / 1000), Math.floor(stagesMe / 1000));

  // ── Apnea events (TIMESTAMP in ms, scoped to in-bed window) ─────────────────
  const apnea = readApnea(db, stagesMs, stagesMe);

  return {
    metrics: {
      tst_min: stats ? tstMin : null,
      sleep_efficiency_pct: validOrNull(stats?.SLEEP_EFFICIENCY ?? null, 0, 100),
      rem_min: stats ? remMin : null,
      deep_min: stats ? deepMin : null,
      light_min: stats ? lightMin : null,
      awake_min: stats ? awakeMin : null,
      // Sleep RHR: prefer MIN_HEART_RATE (true sleep minimum), fall back to
      // AVG_HEART_RATE when MIN is the device sentinel (-1, common on Huawei
      // GT 5 Pro which never reports MIN/MAX during sleep).
      rhr_sleep_bpm:
        validOrNull(stats?.MIN_HEART_RATE ?? null, 30, 199) ??
        validOrNull(stats?.AVG_HEART_RATE ?? null, 30, 199),
      rmssd_ms: validOrNull(stats?.AVG_HRV ?? null, 1, 250),
      spo2_min_pct: validOrNull(spo2?.min_spo ?? stats?.AVG_OXYGEN_SATURATION ?? null, 50, 100),
      breath_rate_mean: validOrNull(stats?.AVG_BREATH_RATE ?? null, 4, 40),
      wake_count:
        stats?.WAKE_COUNT !== null && stats?.WAKE_COUNT !== undefined && stats.WAKE_COUNT >= 0
          ? Math.round(stats.WAKE_COUNT)
          : null,
      rdi: validOrNull(stats?.RDI ?? null, 0, 200),
      hr_min_sleep: validOrNull(stats?.MIN_HEART_RATE ?? null, 30, 199),
      hr_max_sleep: validOrNull(stats?.MAX_HEART_RATE ?? null, 30, 230),
      // Average sleeping HR — fully reported by Huawei, not in v1 schema.
      hr_avg_sleep: validOrNull(stats?.AVG_HEART_RATE ?? null, 30, 199),
      sleep_score: validOrNull(stats?.SLEEP_SCORE ?? null, 0, 100),
      sleep_latency_min: validOrNull(stats?.SLEEP_LATENCY ?? null, 0, 600),
      apnea_events_count: apnea.count,
      apnea_max_level: apnea.maxLevel,
      bedtime_min: rawBedMs && rawBedMs > 0 ? msToLocalMinutes(rawBedMs, win.tz) : null,
      wakeup_min: rawWakeMs && rawWakeMs > 0 ? msToLocalMinutes(rawWakeMs, win.tz) : null,
    },
    rowCount: stageRows.reduce((s, r) => s + r.mins, 0),
    tibMin,
    coveragePct,
  };
}

/** Pull the latest sleep-stats row whose WAKEUP_TIME falls inside the window. */
function readStats(db: Database.Database, win: DayWindow): SleepStatsRow | null {
  try {
    return (
      db
        .prepare<[number, number], SleepStatsRow>(
          `SELECT SLEEP_SCORE, BED_TIME, WAKEUP_TIME, SLEEP_EFFICIENCY,
                  AVG_HRV, AVG_HEART_RATE, AVG_OXYGEN_SATURATION,
                  MIN_HEART_RATE, MAX_HEART_RATE,
                  AVG_BREATH_RATE, WAKE_COUNT, RDI, SLEEP_LATENCY
           FROM HUAWEI_SLEEP_STATS_SAMPLE
           WHERE WAKEUP_TIME >= ? AND WAKEUP_TIME < ?
           ORDER BY WAKEUP_TIME DESC LIMIT 1`,
        )
        .get(win.startMs as number, win.endMs as number) ?? null
    );
  } catch (err) {
    // Column missing on older firmware exports — degrade gracefully.
    console.warn(`[sleep] stats columns missing, falling back: ${(err as Error).message}`);
    return (
      db
        .prepare<[number, number], SleepStatsRow>(
          `SELECT SLEEP_SCORE, BED_TIME, WAKEUP_TIME, SLEEP_EFFICIENCY,
                  AVG_HRV, AVG_HEART_RATE, AVG_OXYGEN_SATURATION, MIN_HEART_RATE,
                  NULL AS MAX_HEART_RATE, NULL AS AVG_BREATH_RATE,
                  NULL AS WAKE_COUNT, NULL AS RDI, NULL AS SLEEP_LATENCY
           FROM HUAWEI_SLEEP_STATS_SAMPLE
           WHERE WAKEUP_TIME >= ? AND WAKEUP_TIME < ?
           ORDER BY WAKEUP_TIME DESC LIMIT 1`,
        )
        .get(win.startMs as number, win.endMs as number) ?? null
    );
  }
}

/**
 * Pull apnea-event aggregate (count + max severity 0..3) for the in-bed window.
 * HUAWEI_SLEEP_APNEA_SAMPLE.TIMESTAMP and LAST_TIMESTAMP are in milliseconds.
 * Returns nulls if the table is missing (older Gadgetbridge schemas).
 */
function readApnea(
  db: Database.Database,
  startMs: number,
  endMs: number,
): { count: number | null; maxLevel: number | null } {
  try {
    // Apnea events span [TIMESTAMP, LAST_TIMESTAMP] and Huawei often writes
    // the summary row stamped at wake-up time (== endMs). Use interval-overlap
    // semantics so events at the wake boundary are still counted: event
    // overlaps [startMs, endMs] iff TIMESTAMP <= endMs AND LAST_TIMESTAMP >= startMs.
    const row = db
      .prepare<[number, number], ApneaAggRow>(
        `SELECT COUNT(*) AS n, MAX(LEVEL) AS max_level
         FROM HUAWEI_SLEEP_APNEA_SAMPLE
         WHERE TIMESTAMP <= ? AND LAST_TIMESTAMP >= ?`,
      )
      .get(endMs, startMs);
    return {
      count: row?.n ?? 0,
      maxLevel:
        row?.max_level !== null && row?.max_level !== undefined ? row.max_level : null,
    };
  } catch (err) {
    console.warn(`[sleep] apnea table missing: ${(err as Error).message}`);
    return { count: null, maxLevel: null };
  }
}

/** Total stage rows (minutes of stage data) for the period — for samples_seen. */
export function countSleepRows(db: Database.Database, win: DayWindow): number {
  const r = db
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n FROM HUAWEI_SLEEP_STAGE_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?`,
    )
    .get(win.startMs as number, win.endMs as number);
  return r?.n ?? 0;
}

/** No-op until we wire branded Ms types in callers — placeholder export. */
export type _MsAlias = Ms;

/**
 * Drop sentinel values that fall outside the physiologically plausible
 * range; Huawei devices emit -1 for "no reading" in several fields.
 */
function validOrNull(v: number | null, lo: number, hi: number): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

/**
 * Convert a UTC ms timestamp to minutes-from-local-midnight in the given tz.
 * Range: 0..1439. Used by coaching levers to compute Schlafmitte stability.
 */
function msToLocalMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}
