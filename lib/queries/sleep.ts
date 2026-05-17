import "server-only";
import { db } from "../db";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../constants";
import type { ApneaEvent, SleepStageBlock, SleepStats, TimeWindow } from "../types";

type StageRow = { ts: number; stage: number };

/**
 * Sleep stage rows are stored with TIMESTAMP in milliseconds. The wake-date
 * filter accepts unix-seconds windows (since/until) and converts internally.
 */

function msWindow(opts?: TimeWindow): { sinceMs: number | null; untilMs: number | null } {
  return {
    sinceMs: opts?.since != null ? opts.since * MS_PER_SECOND : null,
    untilMs: opts?.until != null ? opts.until * MS_PER_SECOND : null,
  };
}

const SLEEP_STAGES = [1, 2, 3, 4] as const;
type SleepStage = (typeof SLEEP_STAGES)[number];
const isSleepStage = (s: number): s is SleepStage =>
  s === 1 || s === 2 || s === 3 || s === 4;

export function getSleepStages(opts?: TimeWindow): SleepStageBlock[] {
  const { sinceMs, untilMs } = msWindow(opts);
  const where: string[] = [];
  const params: number[] = [];
  if (sinceMs != null) {
    where.push("TIMESTAMP >= ?");
    params.push(sinceMs);
  }
  if (untilMs != null) {
    where.push("TIMESTAMP < ?");
    params.push(untilMs);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db()
    .prepare<number[], StageRow>(
      `SELECT TIMESTAMP AS ts, STAGE AS stage FROM HUAWEI_SLEEP_STAGE_SAMPLE ${w} ORDER BY TIMESTAMP ASC`,
    )
    .all(...params);

  return rows
    .filter((r): r is StageRow & { stage: SleepStage } => isSleepStage(r.stage))
    .reduce<SleepStageBlock[]>((blocks, r) => {
      const last = blocks[blocks.length - 1];
      if (last && last.stage === r.stage && r.ts - last.end <= MS_PER_MINUTE) {
        return [...blocks.slice(0, -1), { ...last, end: r.ts + MS_PER_MINUTE }];
      }
      return [...blocks, { stage: r.stage, start: r.ts, end: r.ts + MS_PER_MINUTE }];
    }, []);
}

/**
 * Sleep stats rows are keyed by their own TIMESTAMP (sleep onset, ms). Filter
 * by overlap with the requested window.
 */
export function getSleepStats(opts?: TimeWindow): SleepStats | null {
  const { sinceMs, untilMs } = msWindow(opts);
  const where: string[] = [];
  const params: number[] = [];
  if (untilMs != null) {
    where.push("WAKEUP_TIME <= ?");
    params.push(untilMs);
  }
  if (sinceMs != null) {
    where.push("WAKEUP_TIME >= ?");
    params.push(sinceMs);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const r = db()
    .prepare<
      number[],
      {
        SLEEP_SCORE: number;
        BED_TIME: number;
        RISING_TIME: number;
        WAKEUP_TIME: number;
        SLEEP_LATENCY: number;
        SLEEP_EFFICIENCY: number;
        DEEP_PART: number;
        AVG_HRV: number;
        AVG_BREATH_RATE: number;
        AVG_OXYGEN_SATURATION: number;
        AVG_HEART_RATE: number;
      }
    >(
      `SELECT SLEEP_SCORE, BED_TIME, RISING_TIME, WAKEUP_TIME, SLEEP_LATENCY,
              SLEEP_EFFICIENCY, DEEP_PART, AVG_HRV, AVG_BREATH_RATE,
              AVG_OXYGEN_SATURATION, AVG_HEART_RATE
       FROM HUAWEI_SLEEP_STATS_SAMPLE ${w}
       ORDER BY WAKEUP_TIME DESC LIMIT 1`,
    )
    .get(...params);
  if (!r) return null;
  return {
    score: r.SLEEP_SCORE,
    bedTime: r.BED_TIME,
    risingTime: r.RISING_TIME,
    wakeupTime: r.WAKEUP_TIME,
    latencyMin: r.SLEEP_LATENCY,
    efficiency: r.SLEEP_EFFICIENCY,
    deepPart: r.DEEP_PART,
    avgHrv: r.AVG_HRV,
    avgBreathRate: r.AVG_BREATH_RATE,
    avgSpo2: r.AVG_OXYGEN_SATURATION,
    avgHr: r.AVG_HEART_RATE,
  };
}

export function getApneaEvents(opts?: TimeWindow): ApneaEvent[] {
  const { sinceMs, untilMs } = msWindow(opts);
  const where: string[] = [];
  const params: number[] = [];
  if (sinceMs != null) {
    where.push("TIMESTAMP >= ?");
    params.push(sinceMs);
  }
  if (untilMs != null) {
    where.push("TIMESTAMP < ?");
    params.push(untilMs);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db()
    .prepare<
      number[],
      { TIMESTAMP: number; LAST_TIMESTAMP: number; LEVEL: number }
    >(
      `SELECT TIMESTAMP, LAST_TIMESTAMP, LEVEL FROM HUAWEI_SLEEP_APNEA_SAMPLE ${w} ORDER BY TIMESTAMP ASC`,
    )
    .all(...params);
  return rows.map((r) => ({
    start: r.TIMESTAMP,
    end: r.LAST_TIMESTAMP,
    level: r.LEVEL,
    durationSec: Math.round((r.LAST_TIMESTAMP - r.TIMESTAMP) / 1000),
  }));
}

export function getStageDurations(opts?: TimeWindow) {
  const blocks = getSleepStages(opts);
  const totals = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<1 | 2 | 3 | 4, number>;
  for (const b of blocks) {
    totals[b.stage] += (b.end - b.start) / 1000 / 60;
  }
  return totals;
}
