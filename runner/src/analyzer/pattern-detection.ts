/**
 * Pattern detection — Phase 3 (PROBE_pattern_naming_and_surprise.md).
 *
 * Pure deterministic clustering. Reads up to `daysBack` days of
 * `_facts.json`, builds a per-day feature vector (anomaly flags +
 * sparseness flags + each tracked metric's z-score vs trailing 30d
 * baseline), then clusters days by cosine similarity ≥ 0.75 to an
 * existing centroid. Skips clusters with <2 occurrences.
 *
 * For each cluster we compute `salient_flags`: the top-3 features ranked
 * by |centroid value|, formatted as `{feature}_{direction}_{magnitude}σ`.
 * These flags are the **salience injection** the LLM naming prompt needs
 * — the probe found the LLM picks a coherent narrative not the salient
 * one without explicit pre-ranking.
 *
 * No LLM calls in this module. Naming lives in `pattern-naming.ts`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FactsBundleV2 } from "@/lib/types/generated";

export interface DaySignature {
  date: string;
  /** Normalised z-scored or boolean-as-{0,1} features. */
  features: Record<string, number>;
}

export interface PatternCluster {
  /** Stable hash of feature centroid (top-5 features, rounded). */
  signature_id: string;
  member_dates: string[];
  centroid: Record<string, number>;
  /** Top-3 features by |centroid|, formatted human-readable. */
  salient_flags: string[];
  occurrence_count: number;
  first_seen: string;
  last_seen: string;
}

interface MetricSpec {
  id: string;
  extract: (f: FactsBundleV2) => number | null;
}

const METRICS: readonly MetricSpec[] = [
  { id: "rhr_day_bpm", extract: (f) => num(f.cardio.metrics.rhr_day_bpm) },
  { id: "hr_max_bpm", extract: (f) => num(f.cardio.metrics.hr_max_bpm) },
  { id: "hr_mean_bpm", extract: (f) => num(f.cardio.metrics.hr_mean_bpm) },
  {
    id: "spo2_mean_pct",
    extract: (f) => num(f.cardio.metrics.spo2_mean_pct),
  },
  {
    id: "sleep_efficiency_pct",
    extract: (f) => num(f.sleep?.metrics.sleep_efficiency_pct),
  },
  { id: "tst_min", extract: (f) => num(f.sleep?.metrics.tst_min) },
  {
    id: "sleep_latency_min",
    extract: (f) => num(f.sleep?.metrics.sleep_latency_min),
  },
  {
    id: "breath_rate_mean",
    extract: (f) => num(f.sleep?.metrics.breath_rate_mean),
  },
  { id: "rmssd_ms", extract: (f) => num(f.sleep?.metrics.rmssd_ms) },
  { id: "steps", extract: (f) => num(f.activity.metrics.steps) },
  {
    id: "active_minutes",
    extract: (f) => num(f.activity.metrics.active_minutes),
  },
  {
    id: "sedentary_minutes",
    extract: (f) => num(f.activity.metrics.sedentary_minutes),
  },
  { id: "stress_mean", extract: (f) => num(f.stress.metrics.stress_mean) },
];

/**
 * Boolean feature flags derived from anomalies / signal_quality / wear time.
 * Each returns 0 or 1; embedded with weight 1 so a flag overrides z-noise.
 */
const FLAGS: readonly { id: string; check: (f: FactsBundleV2) => boolean }[] = [
  {
    id: "wear_low",
    check: (f) =>
      typeof f.device?.wear_seconds_24h === "number" &&
      f.device.wear_seconds_24h < 36000, // < 10h
  },
  {
    id: "hr_overflow",
    check: (f) =>
      typeof f.anomalies?.hr_overflow_rows === "number" &&
      f.anomalies.hr_overflow_rows > 0,
  },
  {
    id: "stress_sparse",
    check: (f) => f.stress?.signal_quality?.ok === false,
  },
  {
    id: "sleep_sparse",
    check: (f) => f.sleep?.signal_quality?.ok === false,
  },
  {
    id: "no_data",
    check: (f) =>
      typeof f.device?.wear_seconds_24h === "number" &&
      f.device.wear_seconds_24h === 0,
  },
];

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function priorDatesInclusive(periodKey: string, daysBack: number): string[] {
  const out: string[] = [];
  const base = new Date(`${periodKey}T00:00:00Z`);
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function readFactsOrNull(
  insightsRoot: string,
  date: string,
): Promise<FactsBundleV2 | null> {
  const p = path.join(insightsRoot, "daily", date, "_facts.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, std: 0 };
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
    (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

function cosine(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function signatureIdOf(centroid: Record<string, number>): string {
  // Sort by |value| desc, take top 5, round to 1 decimal, hash.
  const top5 = Object.entries(centroid)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v.toFixed(1)}`)
    .sort();
  const h = fnv1a(top5.join("|"));
  return `sig_${h.toString(16).padStart(8, "0")}`;
}

function salientFlagsOf(centroid: Record<string, number>): string[] {
  // Rank features by |centroid|, take top 3.
  return Object.entries(centroid)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 3)
    .map(([k, v]) => {
      const mag = Math.abs(v);
      const dir = v > 0 ? "high" : v < 0 ? "low" : "flat";
      return `${k}_${dir}_${mag.toFixed(1)}sigma`;
    });
}

/**
 * Build a feature vector for one day. Z-score each metric vs trailing 30d
 * baseline within the input window. Boolean flags embed as +1.
 */
function buildSignature(
  date: string,
  facts: FactsBundleV2 | null,
  trailing: (FactsBundleV2 | null)[],
): DaySignature | null {
  if (!facts) return null;
  const features: Record<string, number> = {};

  for (const spec of METRICS) {
    const today = spec.extract(facts);
    if (today === null) continue;
    const baseline: number[] = [];
    for (const t of trailing) {
      if (!t) continue;
      const v = spec.extract(t);
      if (v !== null) baseline.push(v);
    }
    if (baseline.length < 2) continue;
    const { mean, std } = meanStd(baseline);
    if (!Number.isFinite(std) || std === 0) continue;
    const z = (today - mean) / std;
    if (Number.isFinite(z)) {
      // Cap z to ±5 so a single outlier metric doesn't dominate cosine.
      features[spec.id] = Math.max(-5, Math.min(5, z));
    }
  }

  for (const flag of FLAGS) {
    if (flag.check(facts)) features[flag.id] = 1;
  }

  if (Object.keys(features).length === 0) return null;
  return { date, features };
}

interface MutableCluster {
  centroid: Record<string, number>;
  member_dates: string[];
  /** Sum of feature vectors (used to recompute centroid as we grow). */
  sum: Record<string, number>;
}

function addToCluster(
  cluster: MutableCluster,
  sig: DaySignature,
): void {
  for (const k of Object.keys(sig.features)) {
    cluster.sum[k] = (cluster.sum[k] ?? 0) + sig.features[k];
  }
  cluster.member_dates.push(sig.date);
  // Recompute centroid as mean.
  const n = cluster.member_dates.length;
  cluster.centroid = {};
  for (const k of Object.keys(cluster.sum)) {
    cluster.centroid[k] = cluster.sum[k] / n;
  }
}

function newCluster(sig: DaySignature): MutableCluster {
  return {
    centroid: { ...sig.features },
    member_dates: [sig.date],
    sum: { ...sig.features },
  };
}

/**
 * Detect recurring multi-metric pattern clusters across the last
 * `daysBack` (default 90) days ending at `periodKey` (inclusive).
 *
 * Algorithm:
 *   - For each day d_i: build signature using d_i's metrics z-scored vs
 *     a trailing 30-day window (d_{i-30}..d_{i-1}).
 *   - Greedy centroid clustering with cosine ≥ 0.75 threshold.
 *   - Drop clusters with <2 members.
 *
 * Anchoring to `periodKey` (not wall-clock today) keeps backfill runs
 * correct: re-running an old day clusters the 90 days ending on that day.
 */
export async function detectPatterns(
  insightsRoot: string,
  periodKey: string,
  daysBack = 90,
): Promise<PatternCluster[]> {
  // We need an extra 30 days BEFORE the window to give the first day a
  // 30-day trailing baseline. Read 30 + daysBack days, but only build
  // signatures for the last `daysBack`.
  const totalDays = daysBack + 30;
  const dates = priorDatesInclusive(periodKey, totalDays);
  const facts = await Promise.all(
    dates.map((d) => readFactsOrNull(insightsRoot, d)),
  );

  const signatures: DaySignature[] = [];
  for (let i = 30; i < dates.length; i++) {
    const trailing = facts.slice(i - 30, i);
    const sig = buildSignature(dates[i], facts[i], trailing);
    if (sig) signatures.push(sig);
  }

  // Greedy centroid clustering.
  const clusters: MutableCluster[] = [];
  for (const sig of signatures) {
    let bestIdx = -1;
    let bestSim = -1;
    for (let j = 0; j < clusters.length; j++) {
      const sim = cosine(sig.features, clusters[j].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0 && bestSim >= 0.75) {
      addToCluster(clusters[bestIdx], sig);
    } else {
      clusters.push(newCluster(sig));
    }
  }

  // Build final cluster list, drop singletons, fill metadata.
  const out: PatternCluster[] = [];
  for (const c of clusters) {
    if (c.member_dates.length < 2) continue;
    const dates = [...c.member_dates].sort();
    const signatureId = signatureIdOf(c.centroid);
    const salient = salientFlagsOf(c.centroid);
    out.push({
      signature_id: signatureId,
      member_dates: dates,
      centroid: c.centroid,
      salient_flags: salient,
      occurrence_count: dates.length,
      first_seen: dates[0],
      last_seen: dates[dates.length - 1],
    });
  }
  // Sort: most salient (largest top |centroid|) first.
  out.sort((a, b) => {
    const am = Math.max(0, ...Object.values(a.centroid).map(Math.abs));
    const bm = Math.max(0, ...Object.values(b.centroid).map(Math.abs));
    return bm - am;
  });
  return out;
}
