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

/**
 * Format `ms` as ISO 8601 with the wall-clock components rendered in `tz` and
 * an explicit numeric offset (e.g. "2026-05-18T00:30:00+02:00").
 *
 * `Date.toISOString()` emits the UTC instant with a trailing "Z", which the
 * LLM reads as a wall-clock time and parrots back unshifted — so a 24:00–08:00
 * Berlin night becomes "you slept from 22:00 to 06:00". Including local
 * components plus offset keeps the absolute instant identical while making the
 * user's actual local time visible in the prose.
 */
export function msToLocalIso(ms: number, tz: string): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const yyyy = get("year");
  const mo = get("month");
  const dd = get("day");
  let hh = get("hour");
  if (hh === "24") hh = "00";
  const mi = get("minute");
  const ss = get("second");
  const local = `${yyyy}-${mo}-${dd}T${hh}:${mi}:${ss}`;
  const utcMs = Date.UTC(
    Number(yyyy),
    Number(mo) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss),
  );
  const offsetMin = Math.round((utcMs - d.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${local}${sign}${oh}:${om}`;
}

export { madFn as mad, medianFn as median };
