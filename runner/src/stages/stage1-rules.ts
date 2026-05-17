/**
 * Stage 1 — Rule engine wiring.
 *
 * Adapts the FactsBundleV2 produced by Stage 0 plus state files into the
 * RuleEngineInput shape, runs `runRuleEngine`, and returns the result.
 *
 * History buffers (RuleHistory) are derived from 30 days of per-day SQL
 * aggregates so the engine has data to apply persistence/trend gates against.
 * Today's metrics are included in the history series at the end so the engine
 * can compute trailing-z or trailing-consec correctly.
 */

import type Database from "better-sqlite3";
import type { FactsBundleV2 } from "@/lib/types/generated";
import type {
  AlarmStateV1,
  PauseInputs,
  RuleEngineInput,
  RuleEngineOutput,
  RuleHistory,
} from "../rules/types.ts";
import { runRuleEngine } from "../rules/engine.ts";
import { dayWindow, shiftDateKey } from "../facts/window.ts";
import { config } from "../config.ts";
import type { PauseStateV1 } from "@/lib/types/generated";

const HISTORY_DAYS = 30;
const HISTORY_DAYS_14 = 14;
const HISTORY_DAYS_7 = 7;

/**
 * Derive a RuleHistory bundle from raw daily aggregates for the 30 days
 * preceding period_key (oldest first). Today's value is appended at the end.
 */
export function buildRuleHistory(
  facts: FactsBundleV2,
  database: Database.Database,
): RuleHistory {
  const startKey = shiftDateKey(facts.period_key, HISTORY_DAYS);
  const startWin = dayWindow(startKey, config.timezone);
  const startSec = startWin.startSec as number;
  const startMs = startWin.startMs as number;

  const todayWin = dayWindow(facts.period_key, config.timezone);
  const endSec = todayWin.endSec as number;
  const endMs = todayWin.endMs as number;

  // Per-day sleep aggregates (wake-date semantics). We use SQLite's
  // strftime to bucket by UTC date — close enough for the engine which
  // only cares about ordering + count.
  const sleepRows = database
    .prepare<
      [number, number],
      {
        d: string;
        tst: number | null;
        eff: number | null;
        rmssd: number | null;
        latency: number | null;
        deep_plus_rem: number | null;
        bedtime_min: number | null;
      }
    >(
      `SELECT
         strftime('%Y-%m-%d', WAKEUP_TIME / 1000, 'unixepoch') AS d,
         (SLEEP_EFFICIENCY * (WAKEUP_TIME - BED_TIME) / 100 / 60000) AS tst,
         SLEEP_EFFICIENCY AS eff,
         AVG_HRV AS rmssd,
         SLEEP_LATENCY AS latency,
         NULL AS deep_plus_rem,
         CAST(((BED_TIME / 60000) % 1440) AS INTEGER) AS bedtime_min
       FROM HUAWEI_SLEEP_STATS_SAMPLE
       WHERE WAKEUP_TIME >= ? AND WAKEUP_TIME < ?
       ORDER BY WAKEUP_TIME ASC`,
    )
    .all(startMs, endMs);

  const cardioRows = database
    .prepare<
      [number, number],
      { d: string; rhr: number | null; hr_max: number | null; hr_mean: number | null; rmssd: number | null }
    >(
      `SELECT
         strftime('%Y-%m-%d', TIMESTAMP, 'unixepoch') AS d,
         AVG(CASE WHEN RESTING_HEART_RATE BETWEEN 31 AND 199 THEN RESTING_HEART_RATE END) AS rhr,
         MAX(CASE WHEN HEART_RATE BETWEEN 31 AND 219 THEN HEART_RATE END) AS hr_max,
         AVG(CASE WHEN HEART_RATE BETWEEN 31 AND 219 THEN HEART_RATE END) AS hr_mean,
         NULL AS rmssd
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND OTHER_TIMESTAMP > TIMESTAMP
       GROUP BY d ORDER BY d ASC`,
    )
    .all(startSec, endSec);

  const activityRows = database
    .prepare<
      [number, number],
      { d: string; steps: number | null }
    >(
      `SELECT strftime('%Y-%m-%d', TIMESTAMP, 'unixepoch') AS d,
              SUM(CASE WHEN STEPS > 0 THEN STEPS ELSE 0 END) AS steps
       FROM HUAWEI_ACTIVITY_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
         AND OTHER_TIMESTAMP > TIMESTAMP
       GROUP BY d ORDER BY d ASC`,
    )
    .all(startSec, endSec);

  const stressRows = database
    .prepare<
      [number, number],
      { d: string; high_pct: number | null }
    >(
      `SELECT strftime('%Y-%m-%d', TIMESTAMP, 'unixepoch') AS d,
              CAST(100.0 * SUM(CASE WHEN STRESS >= 80 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0) AS INTEGER) AS high_pct
       FROM HUAWEI_STRESS_SAMPLE
       WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
       GROUP BY d ORDER BY d ASC`,
    )
    .all(startSec, endSec);

  // Apnea per night — bucket by wake-date.
  // HUAWEI_SLEEP_APNEA_SAMPLE.TIMESTAMP is **milliseconds** (per
  // runner/src/facts/queries/sleep.ts), so we pass the ms window and
  // divide for the strftime bucket.
  const apneaRows = (() => {
    try {
      return database
        .prepare<
          [number, number],
          { d: string; events: number; max_level: number | null }
        >(
          `SELECT strftime('%Y-%m-%d', TIMESTAMP / 1000, 'unixepoch') AS d,
                  COUNT(*) AS events,
                  MAX(LEVEL) AS max_level
           FROM HUAWEI_SLEEP_APNEA_SAMPLE
           WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
           GROUP BY d ORDER BY d ASC`,
        )
        .all(startMs, endMs);
    } catch {
      // Table absent on older DB schemas.
      return [] as Array<{ d: string; events: number; max_level: number | null }>;
    }
  })();

  // Sleep stage durations — HUAWEI_SLEEP_STAGE_SAMPLE.TIMESTAMP is in
  // **milliseconds** and each row represents one minute of stage data
  // (per the runner facts query at sleep.ts:11–13). STAGE values:
  // 1=Light, 2=REM, 3=Deep, 4=Awake. Counting rows per stage is therefore
  // the correct minute total.
  const stageRows = (() => {
    try {
      return database
        .prepare<
          [number, number],
          { d: string; deep_min: number | null; rem_min: number | null }
        >(
          `SELECT strftime('%Y-%m-%d', TIMESTAMP / 1000, 'unixepoch') AS d,
                  SUM(CASE WHEN STAGE = 3 THEN 1 ELSE 0 END) AS deep_min,
                  SUM(CASE WHEN STAGE = 2 THEN 1 ELSE 0 END) AS rem_min
           FROM HUAWEI_SLEEP_STAGE_SAMPLE
           WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
           GROUP BY d ORDER BY d ASC`,
        )
        .all(startMs, endMs);
    } catch {
      return [] as Array<{ d: string; deep_min: number | null; rem_min: number | null }>;
    }
  })();

  // Skin temperature: median per night. HUAWEI_TEMPERATURE_SAMPLE.TIMESTAMP
  // is **mixed ms/sec** (see runner/src/facts/queries/body.ts), so we test
  // both ranges via OR and detect magnitude in strftime via a CASE.
  const tempRows = (() => {
    try {
      return database
        .prepare<
          [number, number, number, number],
          { d: string; t_median: number | null }
        >(
          `WITH normalized AS (
             SELECT
               strftime(
                 '%Y-%m-%d',
                 CASE WHEN TIMESTAMP > 1000000000000 THEN TIMESTAMP / 1000 ELSE TIMESTAMP END,
                 'unixepoch'
               ) AS d,
               TEMPERATURE
             FROM HUAWEI_TEMPERATURE_SAMPLE
             WHERE ((TIMESTAMP >= ? AND TIMESTAMP < ?)
                 OR (TIMESTAMP >= ? AND TIMESTAMP < ?))
               AND TEMPERATURE BETWEEN 30 AND 42
           ),
           ranked AS (
             SELECT
               d,
               TEMPERATURE,
               ROW_NUMBER() OVER (PARTITION BY d ORDER BY TEMPERATURE) AS rn,
               COUNT(*)     OVER (PARTITION BY d)                     AS cnt
             FROM normalized
           )
           SELECT d, AVG(TEMPERATURE) AS t_median
           FROM ranked
           WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
           GROUP BY d
           ORDER BY d ASC`,
        )
        .all(startMs, endMs, startSec, endSec);
    } catch {
      return [] as Array<{ d: string; t_median: number | null }>;
    }
  })();

  // Build day index → series. Pad missing days with null.
  const indexByDate = new Map<string, number>();
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const k = shiftDateKey(facts.period_key, HISTORY_DAYS - i);
    indexByDate.set(k, i);
  }
  const tst = Array<number | null>(HISTORY_DAYS).fill(null);
  const eff = Array<number | null>(HISTORY_DAYS).fill(null);
  const rmssd = Array<number | null>(HISTORY_DAYS).fill(null);
  const latency = Array<number | null>(HISTORY_DAYS).fill(null);
  const bedtime = Array<number | null>(HISTORY_DAYS).fill(null);
  for (const r of sleepRows) {
    const idx = indexByDate.get(r.d);
    if (idx === undefined) continue;
    tst[idx] = r.tst;
    eff[idx] = r.eff;
    rmssd[idx] = r.rmssd;
    latency[idx] = r.latency;
    bedtime[idx] = r.bedtime_min;
  }
  const rhr = Array<number | null>(HISTORY_DAYS).fill(null);
  const rhrSleep = Array<number | null>(HISTORY_DAYS).fill(null);
  for (const r of cardioRows) {
    const idx = indexByDate.get(r.d);
    if (idx === undefined) continue;
    rhr[idx] = r.rhr;
    // We don't separate sleep-RHR; reuse rhr.
    rhrSleep[idx] = r.rhr;
  }
  const steps = Array<number | null>(HISTORY_DAYS).fill(null);
  for (const r of activityRows) {
    const idx = indexByDate.get(r.d);
    if (idx === undefined) continue;
    steps[idx] = r.steps;
  }
  // Sedentary blocks per day: count of distinct ≥90-minute spans where
  // STEPS == 0 during waking hours (08:00–22:00 Berlin). Walks the per-minute
  // activity stream once and groups by date.
  const sedentaryRows = (() => {
    try {
      return database
        .prepare<
          [number, number],
          { ts: number; steps: number }
        >(
          `SELECT TIMESTAMP AS ts, STEPS AS steps
           FROM HUAWEI_ACTIVITY_SAMPLE
           WHERE TIMESTAMP >= ? AND TIMESTAMP < ?
             AND OTHER_TIMESTAMP > TIMESTAMP
           ORDER BY TIMESTAMP ASC`,
        )
        .all(startSec, endSec);
    } catch {
      return [] as Array<{ ts: number; steps: number }>;
    }
  })();
  const sedentaryByDate = new Map<string, number>();
  {
    let curDate: string | null = null;
    let runMin = 0;
    let blocksToday = 0;
    const flushDate = () => {
      if (curDate) sedentaryByDate.set(curDate, blocksToday);
    };
    for (const r of sedentaryRows) {
      const dt = new Date(r.ts * 1000);
      const localHour = Number(
        new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit", hourCycle: "h23", timeZone: config.timezone,
        }).format(dt),
      );
      const dateKey = new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", timeZone: config.timezone,
      }).format(dt);
      if (curDate !== dateKey) {
        flushDate();
        curDate = dateKey;
        runMin = 0;
        blocksToday = 0;
      }
      const isWaking = localHour >= 8 && localHour < 22;
      if (isWaking && r.steps === 0) {
        runMin += 1;
      } else {
        if (runMin >= 90) blocksToday += 1;
        runMin = 0;
      }
    }
    if (runMin >= 90 && curDate) blocksToday += 1;
    flushDate();
  }
  const sedentaryAll = Array<number | null>(HISTORY_DAYS).fill(null);
  for (const [d, count] of sedentaryByDate) {
    const idx = indexByDate.get(d);
    if (idx !== undefined) sedentaryAll[idx] = count;
  }

  const stressHigh7 = Array<number | null>(HISTORY_DAYS_7).fill(null);
  // Take last 7 days of stress data ordered by date.
  const stressOrdered = [...stressRows];
  for (let i = 0; i < Math.min(HISTORY_DAYS_7, stressOrdered.length); i++) {
    stressHigh7[HISTORY_DAYS_7 - 1 - i] =
      stressOrdered[stressOrdered.length - 1 - i].high_pct;
  }

  const totalNights = sleepRows.length + (facts.sleep ? 1 : 0);

  // Build 14-day window slice. The HISTORY_DAYS arrays are 30-long; the
  // 14-day arrays are the trailing 14 elements of date-aligned 30-day
  // arrays, then we appendToday the live facts value at index 13.
  const apneaEventsAll = Array<number | null>(HISTORY_DAYS).fill(null);
  const apneaMaxAll = Array<number | null>(HISTORY_DAYS).fill(null);
  for (const r of apneaRows) {
    const idx = indexByDate.get(r.d);
    if (idx === undefined) continue;
    apneaEventsAll[idx] = r.events;
    apneaMaxAll[idx] = r.max_level;
  }
  const deepRemAll = Array<number | null>(HISTORY_DAYS).fill(null);
  for (const r of stageRows) {
    const idx = indexByDate.get(r.d);
    if (idx === undefined) continue;
    const sum = (r.deep_min ?? 0) + (r.rem_min ?? 0);
    deepRemAll[idx] = sum > 0 ? sum : null;
  }
  // Compute today's deep+REM from facts as a fallback so today's tail is set.
  const todayDeepRem =
    facts.sleep?.metrics
      ? ((facts.sleep.metrics.deep_min ?? 0) + (facts.sleep.metrics.rem_min ?? 0)) || null
      : null;

  // Skin temperature delta: median - 28d mean (ignoring nulls).
  const tempMedAll = Array<number | null>(HISTORY_DAYS).fill(null);
  for (const r of tempRows) {
    const idx = indexByDate.get(r.d);
    if (idx === undefined) continue;
    tempMedAll[idx] = r.t_median;
  }
  const tempBaseline = (() => {
    const ok = tempMedAll.filter((v): v is number => v != null);
    if (ok.length < 7) return null;
    return ok.reduce((s, v) => s + v, 0) / ok.length;
  })();
  const skinDeltaAll = tempMedAll.map((v) =>
    v != null && tempBaseline != null ? +(v - tempBaseline).toFixed(2) : null,
  );
  const todaySkinDelta = facts.body?.metrics?.skin_temp_delta_c ?? null;

  // Slice trailing 14 entries; appendToday writes today's known value at idx 13.
  const sliceTail14 = <T>(arr: T[]): T[] => arr.slice(-HISTORY_DAYS_14);

  return {
    rhr_day_bpm_30d: appendToday(rhr, facts.cardio.metrics.rhr_day_bpm),
    rhr_sleep_bpm_30d: appendToday(rhrSleep, facts.sleep?.metrics.rhr_sleep_bpm ?? null),
    rmssd_ms_30d: appendToday(rmssd, facts.sleep?.metrics.rmssd_ms ?? null),
    tst_min_30d: appendToday(tst, facts.sleep?.metrics.tst_min ?? null),
    sleep_efficiency_pct_30d: appendToday(eff, facts.sleep?.metrics.sleep_efficiency_pct ?? null),
    sleep_latency_min_30d: appendToday(latency, null),
    apnea_events_per_night_14d: appendToday(
      sliceTail14(apneaEventsAll),
      facts.sleep?.metrics?.apnea_events_count ?? null,
    ),
    apnea_max_level_14d: appendToday(
      sliceTail14(apneaMaxAll),
      facts.sleep?.metrics?.apnea_max_level ?? null,
    ),
    deep_plus_rem_min_14d: appendToday(sliceTail14(deepRemAll), todayDeepRem),
    skin_temp_delta_c_14d: appendToday(sliceTail14(skinDeltaAll), todaySkinDelta),
    steps_30d: appendToday(steps, facts.activity.metrics.steps),
    sedentary_blocks_90min_14d: sliceTail14(sedentaryAll),
    stress_high_pct_7d: stressHigh7,
    bedtime_min_7d: bedtime.slice(-HISTORY_DAYS_7),
    total_nights_observed: totalNights,
    last_firmware_change_iso: null,
    recent_dst_transition_iso: null,
  };
}

function appendToday(history: (number | null)[], today: number | null): (number | null)[] {
  return [...history.slice(1), today];
}

/**
 * Run Stage 1: build RuleEngineInput and call the engine.
 *
 * `currentLocalTime` is an ISO-8601 wall-clock string (caller must convert
 * UTC → local using `config.timezone`). The engine reads only the hour and
 * date components, so timezone-suffixes are accepted but ignored.
 */
export function runStage1(
  facts: FactsBundleV2,
  alarmState: AlarmStateV1,
  currentLocalTime: string,
  pauseState: PauseStateV1,
  database: Database.Database,
): RuleEngineOutput {
  const history = buildRuleHistory(facts, database);
  const pause: PauseInputs = {
    paused: pauseState.paused,
    i_feel_fine: pauseState.i_feel_fine,
    step_change_detected_on: pauseState.step_change_detected_on,
  };
  const input: RuleEngineInput = {
    facts,
    history,
    alarmState,
    pause,
    currentLocalTime,
  };
  return runRuleEngine(input);
}
