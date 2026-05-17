/**
 * Shared helpers for v3 packagers (sleep, recovery, activity).
 *
 * Pure functions: number bucketing, neighbor facts reads, baseline+delta
 * computation. No I/O beyond filesystem reads.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { mad as madFn, median as medianFn, zRobust } from "../../rules/stats.ts";
import { shiftDateKey } from "../../facts/window.ts";

export interface BaselineStat {
  median: number | null;
  mad: number | null;
  n: number;
}

export type DeltaBand = "high" | "medium" | "within" | "no_baseline";

export interface MetricDelta {
  value: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
  z_score: number | null;
  band: DeltaBand;
}

export function readFactsForDate(
  insightsRoot: string,
  date: string,
): Record<string, unknown> | null {
  const p = path.join(insightsRoot, "daily", date, "_facts.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readNeighborFacts(
  insightsRoot: string,
  periodKey: string,
  daysBack: number[],
): Array<{ date: string; facts: Record<string, unknown> }> {
  const out: Array<{ date: string; facts: Record<string, unknown> }> = [];
  for (const back of daysBack) {
    const date = shiftDateKey(periodKey, back);
    const facts = readFactsForDate(insightsRoot, date);
    if (facts) out.push({ date, facts });
  }
  return out;
}

export function pickBaselines(
  facts: Record<string, unknown> | null,
  domain: string,
  metricKeys: readonly string[],
): Record<string, BaselineStat> {
  const out: Record<string, BaselineStat> = {};
  if (!facts) return out;
  const baseline =
    ((facts[domain] as { baseline?: Record<string, BaselineStat> } | undefined)?.baseline) ?? {};
  for (const k of metricKeys) {
    const b = baseline[k];
    if (b && (b.median != null || b.mad != null)) {
      out[k] = { median: b.median ?? null, mad: b.mad ?? null, n: b.n ?? 0 };
    }
  }
  return out;
}

export function computeDeltas(
  values: Record<string, number | null>,
  baselines: Record<string, BaselineStat>,
): Record<string, MetricDelta> {
  const out: Record<string, MetricDelta> = {};
  for (const [k, value] of Object.entries(values)) {
    const b = baselines[k];
    if (value == null || !b || b.median == null) {
      out[k] = { value, delta_abs: null, delta_pct: null, z_score: null, band: "no_baseline" };
      continue;
    }
    const deltaAbs = value - b.median;
    const deltaPct = b.median !== 0 ? (deltaAbs / b.median) * 100 : null;
    const z = b.mad != null && b.mad > 0 ? zRobust(value, b.median, b.mad) : null;
    const band: DeltaBand =
      z == null ? "no_baseline" : Math.abs(z) >= 2 ? "high" : Math.abs(z) >= 1 ? "medium" : "within";
    out[k] = {
      value,
      delta_abs: round1(deltaAbs),
      delta_pct: deltaPct != null ? round1(deltaPct) : null,
      z_score: z != null ? round1(z) : null,
      band,
    };
  }
  return out;
}

export interface BucketRow<T> {
  ts_iso: string;
  vals: number[];
  raw: T[];
}

export function bucketBy<TRow, TOut>(
  rows: TRow[],
  ts: (r: TRow) => number,
  val: (r: TRow) => number | null,
  bucketMs: number,
  emit: (bucketStartMs: number, vals: number[]) => TOut,
): TOut[] {
  if (rows.length === 0) return [];
  const out: TOut[] = [];
  let bucketStart = Math.floor(ts(rows[0]) / bucketMs) * bucketMs;
  let bucketVals: number[] = [];
  for (const r of rows) {
    const v = val(r);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const t = ts(r);
    const thisBucket = Math.floor(t / bucketMs) * bucketMs;
    if (thisBucket !== bucketStart) {
      if (bucketVals.length > 0) out.push(emit(bucketStart, bucketVals));
      bucketStart = thisBucket;
      bucketVals = [];
    }
    bucketVals.push(v);
  }
  if (bucketVals.length > 0) out.push(emit(bucketStart, bucketVals));
  return out;
}

export function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function msToLocalMinutes(ms: number, tz: string): number {
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

export { madFn as mad, medianFn as median };
