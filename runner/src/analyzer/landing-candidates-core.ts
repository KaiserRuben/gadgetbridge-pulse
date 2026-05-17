/**
 * Pure-Node landing candidate generator.
 *
 * Same math as `lib/landing-candidates.ts` but without the `import "server-only"`
 * guard or `next/cache` calls — so plain `tsx` smoke probes can run it
 * outside the Next.js runtime.
 *
 * The Next-side wrapper (lib/landing-candidates.ts) re-exports the public
 * type + delegates to this kernel after wiring `noStore()` into the request
 * lifecycle. Single source of truth for the math; two surfaces.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FactsBundleV2 } from "@/lib/types/generated";

export type LandingTimeframe = "today" | "trailing_7d" | "trailing_30d";
export type LandingDomain = "sleep" | "heart" | "body" | "activity";

export interface LandingCandidate {
  /** Stable key, e.g. "sleep.tst_min.today". */
  key: string;
  domain: LandingDomain;
  metric: string;
  metric_label_de: string;
  timeframe: LandingTimeframe;
  value: number | null;
  unit: string;
  baseline_mean: number | null;
  baseline_std: number | null;
  z_score: number | null;
  surprise_label: "high" | "medium" | "low";
  trend_direction: "up" | "down" | "flat";
  n_days: number;
  fragile: boolean;
  evidence_de: string;
}

interface MetricSpec {
  id: string;
  domain: LandingDomain;
  label_de: string;
  unit: string;
  decimals: number;
  extract: (f: FactsBundleV2) => number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const METRICS: readonly MetricSpec[] = [
  // sleep
  {
    id: "tst_min",
    domain: "sleep",
    label_de: "Schlafdauer",
    unit: "min",
    decimals: 0,
    extract: (f) => num(f.sleep?.metrics.tst_min),
  },
  {
    id: "sleep_efficiency_pct",
    domain: "sleep",
    label_de: "Schlafeffizienz",
    unit: "%",
    decimals: 0,
    extract: (f) => num(f.sleep?.metrics.sleep_efficiency_pct),
  },
  {
    id: "deep_min",
    domain: "sleep",
    label_de: "Tiefschlaf",
    unit: "min",
    decimals: 0,
    extract: (f) => num(f.sleep?.metrics.deep_min),
  },
  {
    id: "sleep_latency_min",
    domain: "sleep",
    label_de: "Einschlaflatenz",
    unit: "min",
    decimals: 0,
    extract: (f) => num(f.sleep?.metrics.sleep_latency_min),
  },

  // heart
  {
    id: "rhr_day_bpm",
    domain: "heart",
    label_de: "Ruhepuls",
    unit: "bpm",
    decimals: 0,
    extract: (f) => num(f.cardio.metrics.rhr_day_bpm),
  },
  {
    id: "hrv_rmssd",
    domain: "heart",
    label_de: "HRV (RMSSD)",
    unit: "ms",
    decimals: 0,
    extract: (f) => num(f.sleep?.metrics.rmssd_ms),
  },
  {
    id: "spo2_mean_pct",
    domain: "heart",
    label_de: "SpO₂",
    unit: "%",
    decimals: 1,
    extract: (f) => num(f.cardio.metrics.spo2_mean_pct),
  },

  // body
  {
    id: "skin_temp_delta_c",
    domain: "body",
    label_de: "Hauttemp. Δ",
    unit: "°C",
    decimals: 2,
    extract: (f) => num(f.body.metrics.skin_temp_delta_c),
  },
  {
    id: "weight_kg",
    domain: "body",
    label_de: "Gewicht",
    unit: "kg",
    decimals: 1,
    extract: (f) => num(f.body.metrics.weight_kg),
  },

  // activity
  {
    id: "steps",
    domain: "activity",
    label_de: "Schritte",
    unit: "",
    decimals: 0,
    extract: (f) => num(f.activity.metrics.steps),
  },
  {
    id: "active_minutes",
    domain: "activity",
    label_de: "Aktive Minuten",
    unit: "min",
    decimals: 0,
    extract: (f) => num(f.activity.metrics.active_minutes),
  },
  {
    id: "distance_m",
    domain: "activity",
    label_de: "Distanz",
    unit: "m",
    decimals: 0,
    extract: (f) => num(f.activity.metrics.distance_m),
  },
];

function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function loadFactsWindow(
  insightsRoot: string,
  latestDate: string,
  days: number,
): Promise<Array<{ date: string; facts: FactsBundleV2 | null }>> {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(addDays(latestDate, -i));
  return Promise.all(
    dates.map(async (d) => {
      const p = path.join(insightsRoot, "daily", d, "_facts.json");
      try {
        const txt = await readFile(p, "utf8");
        return { date: d, facts: JSON.parse(txt) as FactsBundleV2 };
      } catch {
        return { date: d, facts: null };
      }
    }),
  );
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

function linRegSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += values[i];
    sxy += i * values[i];
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

function bandLabel(zAbs: number): "high" | "medium" | "low" {
  if (!Number.isFinite(zAbs)) return "low";
  if (zAbs >= 3) return "high";
  if (zAbs >= 1.5) return "medium";
  return "low";
}

function trendOf(z: number | null): "up" | "down" | "flat" {
  if (z === null || !Number.isFinite(z)) return "flat";
  if (z >= 0.5) return "up";
  if (z <= -0.5) return "down";
  return "flat";
}

function round(v: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

function fmt(v: number | null, decimals: number): string {
  if (v === null) return "—";
  return round(v, decimals).toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function evidenceFor(
  spec: MetricSpec,
  timeframe: LandingTimeframe,
  value: number | null,
  baselineMean: number | null,
  z: number | null,
): string {
  const unitLabel = spec.unit ? ` ${spec.unit}` : "";
  const valStr = `${fmt(value, spec.decimals)}${unitLabel}`.trim();
  const meanStr =
    baselineMean !== null
      ? `${fmt(baselineMean, spec.decimals)}${unitLabel}`.trim()
      : "—";
  const zStr = z !== null ? ` (z=${z.toFixed(2)})` : "";

  if (timeframe === "today") {
    return `${spec.label_de} ${valStr} vs 14d-Mittel ${meanStr}${zStr}`;
  }
  if (timeframe === "trailing_7d") {
    return `${spec.label_de} 7d-Mittel ${valStr} vs 30d-Mittel ${meanStr}${zStr}`;
  }
  const slopeStr =
    value !== null
      ? `${value >= 0 ? "+" : ""}${fmt(value, spec.decimals + 1)}${unitLabel}/Tag`.trim()
      : "—";
  return `${spec.label_de} 30d-Trend ${slopeStr}${zStr}`;
}

/**
 * Pure-Node candidate generator. See lib/landing-candidates.ts for the
 * Next-flavoured wrapper that adds noStore() + a default insightsRoot.
 */
export async function computeLandingCandidates(
  insightsRoot: string,
  latestDate: string,
): Promise<LandingCandidate[]> {
  const window = await loadFactsWindow(insightsRoot, latestDate, 30);
  const todayFacts = window[window.length - 1]?.facts ?? null;

  const trailing14 = window.slice(window.length - 15, window.length - 1);
  const trailing30NoToday = window.slice(0, window.length - 1);

  const out: LandingCandidate[] = [];

  for (const spec of METRICS) {
    // ── today ──────────────────────────────────────────────────────
    const todayValue = todayFacts ? spec.extract(todayFacts) : null;
    const todayBaseline: number[] = [];
    for (const w of trailing14) {
      if (!w.facts) continue;
      const v = spec.extract(w.facts);
      if (v !== null) todayBaseline.push(v);
    }
    const todayStats = meanStd(todayBaseline);
    const todayFragile = todayBaseline.length < 5;
    let todayZ: number | null = null;
    if (
      todayValue !== null &&
      todayStats.std > 0 &&
      Number.isFinite(todayStats.std)
    ) {
      todayZ = (todayValue - todayStats.mean) / todayStats.std;
      if (!Number.isFinite(todayZ)) todayZ = null;
    }
    const todayLabel: "high" | "medium" | "low" = todayFragile
      ? "low"
      : bandLabel(todayZ === null ? 0 : Math.abs(todayZ));

    out.push({
      key: `${spec.domain}.${spec.id}.today`,
      domain: spec.domain,
      metric: spec.id,
      metric_label_de: spec.label_de,
      timeframe: "today",
      value: todayValue,
      unit: spec.unit,
      baseline_mean: todayBaseline.length > 0 ? todayStats.mean : null,
      baseline_std: todayBaseline.length >= 2 ? todayStats.std : null,
      z_score: todayZ,
      surprise_label: todayLabel,
      trend_direction: trendOf(todayZ),
      n_days: todayBaseline.length,
      fragile: todayFragile,
      evidence_de: evidenceFor(
        spec,
        "today",
        todayValue,
        todayBaseline.length > 0 ? todayStats.mean : null,
        todayZ,
      ),
    });

    // ── trailing_7d ────────────────────────────────────────────────
    const last7Window = window.slice(window.length - 7);
    const last7Values: number[] = [];
    for (const w of last7Window) {
      if (!w.facts) continue;
      const v = spec.extract(w.facts);
      if (v !== null) last7Values.push(v);
    }
    const sevenMean =
      last7Values.length > 0
        ? last7Values.reduce((a, b) => a + b, 0) / last7Values.length
        : null;
    const baseline30Excl7: number[] = [];
    const before7 = window.slice(0, window.length - 7);
    for (const w of before7) {
      if (!w.facts) continue;
      const v = spec.extract(w.facts);
      if (v !== null) baseline30Excl7.push(v);
    }
    const sevenStats = meanStd(baseline30Excl7);
    const sevenFragile = baseline30Excl7.length < 5;
    let sevenZ: number | null = null;
    if (
      sevenMean !== null &&
      sevenStats.std > 0 &&
      Number.isFinite(sevenStats.std)
    ) {
      sevenZ = (sevenMean - sevenStats.mean) / sevenStats.std;
      if (!Number.isFinite(sevenZ)) sevenZ = null;
    }
    const sevenLabel: "high" | "medium" | "low" = sevenFragile
      ? "low"
      : bandLabel(sevenZ === null ? 0 : Math.abs(sevenZ));

    out.push({
      key: `${spec.domain}.${spec.id}.trailing_7d`,
      domain: spec.domain,
      metric: spec.id,
      metric_label_de: spec.label_de,
      timeframe: "trailing_7d",
      value: sevenMean,
      unit: spec.unit,
      baseline_mean:
        baseline30Excl7.length > 0 ? sevenStats.mean : null,
      baseline_std: baseline30Excl7.length >= 2 ? sevenStats.std : null,
      z_score: sevenZ,
      surprise_label: sevenLabel,
      trend_direction: trendOf(sevenZ),
      n_days: last7Values.length,
      fragile: sevenFragile,
      evidence_de: evidenceFor(
        spec,
        "trailing_7d",
        sevenMean,
        baseline30Excl7.length > 0 ? sevenStats.mean : null,
        sevenZ,
      ),
    });

    // ── trailing_30d ───────────────────────────────────────────────
    const series30: number[] = [];
    for (const w of trailing30NoToday) {
      if (!w.facts) continue;
      const v = spec.extract(w.facts);
      if (v !== null) series30.push(v);
    }
    if (todayValue !== null) series30.push(todayValue);

    const slopePerDay = series30.length >= 2 ? linRegSlope(series30) : null;
    const baseline30Stats = meanStd(series30);
    const thirtyFragile = series30.length < 5;
    let thirtyZ: number | null = null;
    if (
      slopePerDay !== null &&
      baseline30Stats.std > 0 &&
      Number.isFinite(baseline30Stats.std)
    ) {
      thirtyZ = (slopePerDay * series30.length) / baseline30Stats.std;
      if (!Number.isFinite(thirtyZ)) thirtyZ = null;
    }
    const thirtyLabel: "high" | "medium" | "low" = thirtyFragile
      ? "low"
      : bandLabel(thirtyZ === null ? 0 : Math.abs(thirtyZ));

    out.push({
      key: `${spec.domain}.${spec.id}.trailing_30d`,
      domain: spec.domain,
      metric: spec.id,
      metric_label_de: spec.label_de,
      timeframe: "trailing_30d",
      value: slopePerDay,
      unit: spec.unit,
      baseline_mean:
        series30.length > 0 ? baseline30Stats.mean : null,
      baseline_std: series30.length >= 2 ? baseline30Stats.std : null,
      z_score: thirtyZ,
      surprise_label: thirtyLabel,
      trend_direction: trendOf(thirtyZ),
      n_days: series30.length,
      fragile: thirtyFragile,
      evidence_de: evidenceFor(
        spec,
        "trailing_30d",
        slopePerDay,
        series30.length > 0 ? baseline30Stats.mean : null,
        thirtyZ,
      ),
    });
  }

  // Drop "low" candidates EXCEPT when their domain would otherwise be empty.
  const domains: LandingDomain[] = ["sleep", "heart", "body", "activity"];
  const aboveLow = out.filter((c) => c.surprise_label !== "low");
  const kept: LandingCandidate[] = [...aboveLow];
  for (const dom of domains) {
    if (kept.some((c) => c.domain === dom)) continue;
    const lows = out
      .filter((c) => c.domain === dom)
      .sort((a, b) => {
        const za = Math.abs(a.z_score ?? 0);
        const zb = Math.abs(b.z_score ?? 0);
        if (zb !== za) return zb - za;
        if (a.fragile !== b.fragile) return a.fragile ? 1 : -1;
        const tfRank: Record<LandingTimeframe, number> = {
          today: 0,
          trailing_7d: 1,
          trailing_30d: 2,
        };
        return tfRank[a.timeframe] - tfRank[b.timeframe];
      });
    if (lows.length > 0) kept.push(lows[0]);
  }

  const domainRank: Record<LandingDomain, number> = {
    sleep: 0,
    heart: 1,
    body: 2,
    activity: 3,
  };
  kept.sort((a, b) => {
    const za = Math.abs(a.z_score ?? 0);
    const zb = Math.abs(b.z_score ?? 0);
    if (zb !== za) return zb - za;
    if (a.fragile !== b.fragile) return a.fragile ? 1 : -1;
    return domainRank[a.domain] - domainRank[b.domain];
  });

  return kept;
}
