import "server-only";
import { db } from "../db";
import { MS_EPOCH_THRESHOLD, MS_PER_SECOND } from "../constants";
import type { HrvSample, StressSample, TempSample, TimeWindow } from "../types";

function tsToSec(ts: number): number {
  return ts > MS_EPOCH_THRESHOLD ? Math.floor(ts / MS_PER_SECOND) : ts;
}

function buildWindow(opts?: TimeWindow, msColumn = "TIMESTAMP") {
  // Some Huawei tables store TIMESTAMP in ms, others in seconds. We compare
  // against both forms and accept either.
  if (!opts || (opts.since == null && opts.until == null)) {
    return { sql: "", params: [] as number[] };
  }
  const where: string[] = [];
  const params: number[] = [];
  if (opts.since != null) {
    where.push(`(${msColumn} >= ? OR ${msColumn} >= ?)`);
    params.push(opts.since * MS_PER_SECOND, opts.since);
  }
  if (opts.until != null) {
    where.push(`(${msColumn} < ? OR ${msColumn} < ?)`);
    params.push(opts.until * MS_PER_SECOND, opts.until);
  }
  return { sql: ` WHERE ${where.join(" AND ")}`, params };
}

export function getStress(opts?: TimeWindow): StressSample[] {
  const { sql, params } = buildWindow(opts);
  return db()
    .prepare<
      number[],
      { TIMESTAMP: number; STRESS: number; LEVEL: number }
    >(
      `SELECT TIMESTAMP, STRESS, LEVEL FROM HUAWEI_STRESS_SAMPLE${sql} ORDER BY TIMESTAMP ASC`,
    )
    .all(...params)
    .map((r) => ({ ts: tsToSec(r.TIMESTAMP), stress: r.STRESS, level: r.LEVEL }));
}

export function getTemperature(opts?: TimeWindow): TempSample[] {
  const { sql, params } = buildWindow(opts);
  return db()
    .prepare<
      number[],
      { TIMESTAMP: number; TEMPERATURE: number }
    >(
      `SELECT TIMESTAMP, TEMPERATURE FROM HUAWEI_TEMPERATURE_SAMPLE${sql} ORDER BY TIMESTAMP ASC`,
    )
    .all(...params)
    .map((r) => ({ ts: tsToSec(r.TIMESTAMP), celsius: r.TEMPERATURE }));
}

export function getHrv(opts?: TimeWindow): HrvSample[] {
  const { sql, params } = buildWindow(opts);
  return db()
    .prepare<
      number[],
      { TIMESTAMP: number; VALUE: number }
    >(
      `SELECT TIMESTAMP, VALUE FROM HUAWEI_HRV_VALUE_SAMPLE${sql} ORDER BY TIMESTAMP ASC`,
    )
    .all(...params)
    .map((r) => ({ ts: tsToSec(r.TIMESTAMP), ms: r.VALUE }));
}
