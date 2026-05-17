/**
 * Stage 2 — Similar-day retrieval.
 *
 * Indexes the trailing 90 days of `_facts.json` by a 4-feature vector
 * (rhr_day_bpm, tst_min, sleep_efficiency_pct, stress_mean) z-scored
 * across the window, then returns the top-K nearest neighbours of the
 * query day (the day we're producing an insight for) by Euclidean
 * distance in z-space. Days with any null in the feature vector are
 * skipped during indexing.
 *
 * Shared-drivers heuristic: if a candidate day's daily.json drivers
 * reference the same metric_id as a current observation we've already
 * tagged S2/S3 (mid-tier), we surface it. The list is informational —
 * the LLM uses it for "ähnlich war Mo, 2026-04-27" framing.
 *
 * Catastrophic failure (filesystem, parse) returns [] — never throws.
 * Insufficient samples (<10 valid days) also returns []; the LLM then
 * skips the similar-day frame.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";
import { config } from "../config.ts";

export interface SimilarDay {
  /** ISO date YYYY-MM-DD of the similar day. */
  period_key: string;
  /** Distance score in feature space; lower = more similar. */
  distance: number;
  /** Headline drivers shared with the query day, if any. */
  shared_drivers: string[];
}

const WINDOW_DAYS = 90;
const MIN_VALID_DAYS = 10;
const FEATURE_KEYS = ["rhr", "tst", "eff", "stress"] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];
type Vector = Record<FeatureKey, number>;

function readVector(f: FactsBundleV2): Vector | null {
  const rhr = f.cardio?.metrics?.rhr_day_bpm;
  const tst = f.sleep?.metrics?.tst_min;
  const eff = f.sleep?.metrics?.sleep_efficiency_pct;
  const stress = f.stress?.metrics?.stress_mean;
  if (typeof rhr !== "number" || typeof tst !== "number"
      || typeof eff !== "number" || typeof stress !== "number") return null;
  return { rhr, tst, eff, stress };
}

async function readFacts(p: string): Promise<FactsBundleV2 | null> {
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
}

async function readDaily(p: string): Promise<DailyInsightV2 | null> {
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as DailyInsightV2;
  } catch {
    return null;
  }
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function meanStd(xs: number[]): { mean: number; std: number } {
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const variance = xs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / xs.length;
  // Floor std at 1e-3 so a perfectly-flat axis doesn't cause divide-by-zero
  // when only 1 unique value is observed.
  return { mean, std: Math.max(Math.sqrt(variance), 1e-3) };
}

/**
 * Returns the top-K most similar prior days. Reads from
 * `<insightsRoot>/daily/<date>/_facts.json` for the trailing window,
 * skipping the query day itself. K is capped at 3 by default.
 */
export async function findSimilarDays(
  facts: FactsBundleV2,
  limit = 3,
): Promise<SimilarDay[]> {
  const queryVec = readVector(facts);
  if (!queryVec) {
    console.log("[stage2] query day missing features, skipping");
    return [];
  }

  const insightsRoot = config.insightsRoot;
  const queryKey = facts.period_key;

  // Build candidate dates (oldest → newest), exclude the query day itself.
  const dates: string[] = [];
  for (let i = WINDOW_DAYS; i >= 1; i--) dates.push(shiftDate(queryKey, -i));

  // Load all _facts.json in parallel.
  const factsArr = await Promise.all(
    dates.map((d) => readFacts(path.join(insightsRoot, "daily", d, "_facts.json"))),
  );

  // Collect valid (date, vector) pairs.
  const valid: Array<{ date: string; vec: Vector }> = [];
  for (let i = 0; i < dates.length; i++) {
    const f = factsArr[i];
    if (!f) continue;
    const v = readVector(f);
    if (v) valid.push({ date: dates[i], vec: v });
  }

  if (valid.length < MIN_VALID_DAYS) {
    console.log(`[stage2] only ${valid.length} valid days (<${MIN_VALID_DAYS}), skipping`);
    return [];
  }

  // Per-feature mean/std across the window (NOT including query day).
  const stats: Record<FeatureKey, { mean: number; std: number }> = {
    rhr: meanStd(valid.map((v) => v.vec.rhr)),
    tst: meanStd(valid.map((v) => v.vec.tst)),
    eff: meanStd(valid.map((v) => v.vec.eff)),
    stress: meanStd(valid.map((v) => v.vec.stress)),
  };

  // Z-score the query.
  const queryZ: Vector = {
    rhr: (queryVec.rhr - stats.rhr.mean) / stats.rhr.std,
    tst: (queryVec.tst - stats.tst.mean) / stats.tst.std,
    eff: (queryVec.eff - stats.eff.mean) / stats.eff.std,
    stress: (queryVec.stress - stats.stress.mean) / stats.stress.std,
  };

  // Score each candidate by Euclidean distance in z-space.
  const scored = valid.map((c) => {
    const z: Vector = {
      rhr: (c.vec.rhr - stats.rhr.mean) / stats.rhr.std,
      tst: (c.vec.tst - stats.tst.mean) / stats.tst.std,
      eff: (c.vec.eff - stats.eff.mean) / stats.eff.std,
      stress: (c.vec.stress - stats.stress.mean) / stats.stress.std,
    };
    let dsq = 0;
    for (const k of FEATURE_KEYS) {
      const dz = z[k] - queryZ[k];
      dsq += dz * dz;
    }
    return { date: c.date, distance: +Math.sqrt(dsq).toFixed(3) };
  });
  scored.sort((a, b) => a.distance - b.distance);
  const top = scored.slice(0, limit);

  // Optional shared-drivers enrichment: load each top candidate's daily.json
  // and pluck driver metric_ids. Best-effort; missing daily.json → empty.
  const enriched = await Promise.all(
    top.map(async (t) => {
      const daily = await readDaily(path.join(insightsRoot, "daily", t.date, "daily.json"));
      const sharedDrivers: string[] = [];
      if (daily && !daily.abstain) {
        for (const d of daily.drivers) sharedDrivers.push(d.metric_id);
      }
      return {
        period_key: t.date,
        distance: t.distance,
        shared_drivers: sharedDrivers.slice(0, 3),
      };
    }),
  );

  console.log(
    `[stage2] retrieved ${enriched.length} similar days from ${valid.length}-day window`,
  );
  return enriched;
}
