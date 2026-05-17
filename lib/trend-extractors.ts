import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";
import { addDays } from "@/lib/time";
import { loadDaily, getLatestDailyDate } from "@/lib/insights";
import { todayKey } from "@/lib/time";
import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";

/**
 * Trend-page data extractors.
 *
 * Each per-domain helper loads a trailing window of `_facts.json` (and, for
 * sleep, the matching `daily.json` so we can surface the verdict band per
 * night) and projects it to the shapes the trend-page chart components want.
 *
 * Strategy: one fan-out per call (≤ 30 file reads per domain), no caching —
 * the FS reads are cheap and the pages tolerate gaps natively.
 */

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT =
  process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

async function readFacts(date: string): Promise<FactsBundleV2 | null> {
  const p = path.join(INSIGHTS_ROOT, "daily", date, "_facts.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
}

/** Build a trailing-N-day window ending at `anchor`, oldest → newest. */
function buildWindowDates(anchor: string, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDays(anchor, -i));
  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[], mu: number): number | null {
  if (values.length < 2) return null;
  const variance =
    values.reduce((s, v) => s + (v - mu) * (v - mu), 0) / values.length;
  return Math.sqrt(variance);
}

/** Resolve the anchor date for a trend page: latest with data, else today. */
export async function resolveTrendAnchor(): Promise<string> {
  return (await getLatestDailyDate()) ?? todayKey();
}

// ─── shared types ───────────────────────────────────────────────────────────

export type TrendPoint = { date: string; value: number | null };

export type TrendKpi = {
  /** Mean over the current window. `null` if no samples. */
  mean: number | null;
  /** Mean over the prior equal-length window (for delta vs prior period). */
  prevMean: number | null;
  /** Absolute delta `mean - prevMean`. `null` if either side missing. */
  delta: number | null;
  /** Number of non-null samples in the current window. */
  n: number;
  /** 14-day-tail sparkline values, oldest → newest. Nulls dropped. */
  sparkline: number[];
};

function computeKpi(series: TrendPoint[]): TrendKpi {
  const numeric = series.map((p) => p.value).filter((v): v is number => v !== null);
  return {
    mean: mean(numeric),
    prevMean: null,
    delta: null,
    n: numeric.length,
    sparkline: series
      .slice(-14)
      .map((p) => p.value)
      .filter((v): v is number => v !== null),
  };
}

function attachPrev(kpi: TrendKpi, prevSeries: TrendPoint[]): TrendKpi {
  const prevNumeric = prevSeries
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const prev = mean(prevNumeric);
  return {
    ...kpi,
    prevMean: prev,
    delta: kpi.mean !== null && prev !== null ? kpi.mean - prev : null,
  };
}

// ─── sleep ─────────────────────────────────────────────────────────────────

export type SleepNightSummary = {
  date: string;
  /** Verdict band sourced from daily.json so the recent-nights row can color cards. */
  verdict_band: DailyInsightV2["verdict_band"];
  /** Total sleep time in minutes (light + deep + rem). */
  tst_min: number | null;
  /** Stage proportions in pct of TST. `null` if TST is unknown / zero. */
  deep_pct: number | null;
  rem_pct: number | null;
  light_pct: number | null;
  awake_pct: number | null;
  efficiency_pct: number | null;
  score: number | null;
  bedtime_min: number | null;
};

export type SleepTrend = {
  anchor: string;
  /** 30-day TST series in hours (null gaps preserved). */
  tstSeries30d: TrendPoint[];
  /** 30-day sleep efficiency series (%) for the year heatmap baseline. */
  efficiencySeries30d: TrendPoint[];
  /** 30-day RMSSD/HRV series. */
  hrvSeries30d: TrendPoint[];
  /** 30-day stage-proportion stack (deep/rem/light/awake pct of TST). */
  stageStack30d: SleepNightSummary[];
  /** Last 7 nights ordered oldest → newest. */
  recentNights: SleepNightSummary[];
  /** KPI block aggregated over the 30-day current window vs prior 30 days. */
  tstKpi: TrendKpi;
  scoreKpi: TrendKpi;
  efficiencyKpi: TrendKpi;
  /** Bedtime stddev over the last 14 nights, in minutes from local midnight. */
  bedtimeStdMin14d: number | null;
  /** Bedtime scatter for last 30 nights. */
  bedtimeScatter30d: TrendPoint[];
};

function pct(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null) return null;
  if (whole <= 0) return null;
  return (part / whole) * 100;
}

export async function getSleepTrend(daysBack = 30): Promise<SleepTrend> {
  noStore();
  const anchor = await resolveTrendAnchor();
  const dates = buildWindowDates(anchor, daysBack);
  const prevDates = buildWindowDates(addDays(anchor, -daysBack), daysBack);

  const [factsWindow, dailyWindow, prevFactsWindow] = await Promise.all([
    Promise.all(dates.map((d) => readFacts(d))),
    Promise.all(dates.map((d) => loadDaily(d))),
    Promise.all(prevDates.map((d) => readFacts(d))),
  ]);

  const tstSeries30d: TrendPoint[] = dates.map((date, i) => {
    const tst = factsWindow[i]?.sleep?.metrics.tst_min;
    return {
      date,
      value: typeof tst === "number" && tst > 0 ? tst / 60 : null,
    };
  });

  const efficiencySeries30d: TrendPoint[] = dates.map((date, i) => {
    const e = factsWindow[i]?.sleep?.metrics.sleep_efficiency_pct;
    return { date, value: typeof e === "number" ? e : null };
  });

  const hrvSeries30d: TrendPoint[] = dates.map((date, i) => {
    const v = factsWindow[i]?.sleep?.metrics.rmssd_ms;
    return { date, value: typeof v === "number" ? v : null };
  });

  // Score kpi: pull SLEEP_SCORE-equivalent from facts if missing in daily.
  // Daily insight doesn't carry the device score; only sleep score we can read
  // is in the v2.1 facts (SLEEP_SCORE-equivalent) — but that field is not in
  // the public schema. We fall back to sleep_efficiency as a stand-in.
  const scoreSeries30d: TrendPoint[] = dates.map((date, i) => {
    // Prefer recorded sleep score if present (some facts versions stash it).
    const sleepBlock = factsWindow[i]?.sleep?.metrics as
      | { sleep_score?: unknown }
      | undefined;
    if (
      sleepBlock &&
      typeof sleepBlock.sleep_score === "number" &&
      Number.isFinite(sleepBlock.sleep_score)
    ) {
      return { date, value: sleepBlock.sleep_score };
    }
    return { date, value: null };
  });

  // Aggregate KPIs
  const tstKpi = computeKpi(tstSeries30d);
  const efficiencyKpi = computeKpi(efficiencySeries30d);
  const scoreKpiRaw = computeKpi(scoreSeries30d);

  const prevTstSeries: TrendPoint[] = prevDates.map((date, i) => {
    const tst = prevFactsWindow[i]?.sleep?.metrics.tst_min;
    return {
      date,
      value: typeof tst === "number" && tst > 0 ? tst / 60 : null,
    };
  });
  const prevEffSeries: TrendPoint[] = prevDates.map((date, i) => {
    const e = prevFactsWindow[i]?.sleep?.metrics.sleep_efficiency_pct;
    return { date, value: typeof e === "number" ? e : null };
  });

  const tstKpiWithPrev = attachPrev(tstKpi, prevTstSeries);
  const efficiencyKpiWithPrev = attachPrev(efficiencyKpi, prevEffSeries);

  // Stage proportions: oldest → newest, last 30 nights.
  const stageStack30d: SleepNightSummary[] = dates.map((date, i) => {
    const facts = factsWindow[i];
    const daily = dailyWindow[i];
    const m = facts?.sleep?.metrics;
    const tstMin = typeof m?.tst_min === "number" ? m.tst_min : null;
    const deep = typeof m?.deep_min === "number" ? m.deep_min : null;
    const rem = typeof m?.rem_min === "number" ? m.rem_min : null;
    const light = typeof m?.light_min === "number" ? m.light_min : null;
    const awake = typeof m?.awake_min === "number" ? m.awake_min : null;
    const eff =
      typeof m?.sleep_efficiency_pct === "number"
        ? m.sleep_efficiency_pct
        : null;
    const bedtime =
      typeof (m as { bedtime_min?: unknown })?.bedtime_min === "number"
        ? ((m as { bedtime_min?: number }).bedtime_min as number)
        : null;
    return {
      date,
      verdict_band: daily && !daily.abstain ? daily.verdict_band : null,
      tst_min: tstMin,
      deep_pct: pct(deep, tstMin),
      rem_pct: pct(rem, tstMin),
      light_pct: pct(light, tstMin),
      awake_pct: pct(awake, tstMin),
      efficiency_pct: eff,
      score: null,
      bedtime_min: bedtime,
    };
  });

  const recentNights = stageStack30d.slice(-7);

  // Bedtime regularity: compute stddev over last 14 nights, with wrap-around
  // handling for bedtimes that cross midnight (Huawei stores these as e.g.
  // 1320 minutes = 22:00 the previous evening). We treat anything > 720 as a
  // pre-midnight bedtime represented as `bedtime - 1440` so the modulo math
  // stays linear around midnight.
  const last14Bed = stageStack30d
    .slice(-14)
    .map((n) => n.bedtime_min)
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .map((v) => (v > 720 ? v - 1440 : v));
  const muBed = mean(last14Bed);
  const bedtimeStdMin14d =
    muBed !== null && last14Bed.length >= 5 ? stddev(last14Bed, muBed) : null;

  const bedtimeScatter30d: TrendPoint[] = stageStack30d.map((n) => ({
    date: n.date,
    value:
      n.bedtime_min !== null
        ? n.bedtime_min > 720
          ? n.bedtime_min - 1440
          : n.bedtime_min
        : null,
  }));

  return {
    anchor,
    tstSeries30d,
    efficiencySeries30d,
    hrvSeries30d,
    stageStack30d,
    recentNights,
    tstKpi: tstKpiWithPrev,
    scoreKpi: scoreKpiRaw,
    efficiencyKpi: efficiencyKpiWithPrev,
    bedtimeStdMin14d,
    bedtimeScatter30d,
  };
}

// ─── heart ─────────────────────────────────────────────────────────────────

export type HeartTrend = {
  anchor: string;
  rhrSeries30d: TrendPoint[];
  hrvSeries30d: TrendPoint[];
  hrMaxSeries30d: TrendPoint[];
  spo2Series30d: TrendPoint[];
  hrAvgSeries30d: TrendPoint[];
  rhrKpi: TrendKpi;
  hrvKpi: TrendKpi;
  hrMaxKpi: TrendKpi;
  /** Personal RHR baseline band (mean ± 1σ over last 14 days). */
  rhrBaseline: { mean: number | null; std: number | null; n: number };
  /** SpO2 distribution (samples per integer percent) over 30d. */
  spo2Histogram: number[];
  /**
   * Aggregate time-in-zone over 30 days. Zones use the same cutoffs as
   * `HR_ZONES`. We don't have a per-day zone breakdown in facts, so we infer
   * a coarse share by mapping `hr_max_bpm` and `hr_mean_bpm` to a single
   * representative zone-bucket count per day. Suitable for the "Zone-Verteilung
   * über 30 Tage" overview but not the per-day detail.
   */
  zoneCounts: Array<{ label: string; count: number }>;
  /** Last 7 days (oldest → newest) with per-day RHR + HRV chips. */
  recentDays: Array<{
    date: string;
    rhr: number | null;
    hrv: number | null;
    band: DailyInsightV2["verdict_band"];
  }>;
};

const HR_ZONE_CUTOFFS: ReadonlyArray<{
  label: string;
  min: number;
  max: number;
}> = [
  { label: "Rest", min: 0, max: 90 },
  { label: "Easy", min: 90, max: 110 },
  { label: "Aerobic", min: 110, max: 130 },
  { label: "Threshold", min: 130, max: 150 },
  { label: "Max", min: 150, max: 220 },
];

export async function getHeartTrend(daysBack = 30): Promise<HeartTrend> {
  noStore();
  const anchor = await resolveTrendAnchor();
  const dates = buildWindowDates(anchor, daysBack);
  const prevDates = buildWindowDates(addDays(anchor, -daysBack), daysBack);

  const [factsWindow, dailyWindow, prevFactsWindow] = await Promise.all([
    Promise.all(dates.map((d) => readFacts(d))),
    Promise.all(dates.map((d) => loadDaily(d))),
    Promise.all(prevDates.map((d) => readFacts(d))),
  ]);

  const rhrSeries30d: TrendPoint[] = dates.map((date, i) => ({
    date,
    value:
      typeof factsWindow[i]?.cardio?.metrics?.rhr_day_bpm === "number"
        ? (factsWindow[i] as FactsBundleV2).cardio.metrics.rhr_day_bpm
        : null,
  }));
  const hrAvgSeries30d: TrendPoint[] = dates.map((date, i) => ({
    date,
    value:
      typeof factsWindow[i]?.cardio?.metrics?.hr_mean_bpm === "number"
        ? (factsWindow[i] as FactsBundleV2).cardio.metrics.hr_mean_bpm
        : null,
  }));
  const hrMaxSeries30d: TrendPoint[] = dates.map((date, i) => ({
    date,
    value:
      typeof factsWindow[i]?.cardio?.metrics?.hr_max_bpm === "number"
        ? (factsWindow[i] as FactsBundleV2).cardio.metrics.hr_max_bpm
        : null,
  }));
  const spo2Series30d: TrendPoint[] = dates.map((date, i) => ({
    date,
    value:
      typeof factsWindow[i]?.cardio?.metrics?.spo2_mean_pct === "number"
        ? (factsWindow[i] as FactsBundleV2).cardio.metrics.spo2_mean_pct
        : null,
  }));
  // HRV = sleep RMSSD on this device (the HRV sample stream during the day is
  // sparse; the trustworthy daily HRV reading is the overnight one).
  const hrvSeries30d: TrendPoint[] = dates.map((date, i) => ({
    date,
    value:
      typeof factsWindow[i]?.sleep?.metrics?.rmssd_ms === "number"
        ? (factsWindow[i] as FactsBundleV2).sleep!.metrics.rmssd_ms
        : null,
  }));

  // KPIs current vs previous period.
  const rhrKpi = computeKpi(rhrSeries30d);
  const hrvKpi = computeKpi(hrvSeries30d);
  const hrMaxKpi = computeKpi(hrMaxSeries30d);
  const prevRhr: TrendPoint[] = prevDates.map((date, i) => ({
    date,
    value:
      typeof prevFactsWindow[i]?.cardio?.metrics?.rhr_day_bpm === "number"
        ? (prevFactsWindow[i] as FactsBundleV2).cardio.metrics.rhr_day_bpm
        : null,
  }));
  const prevHrv: TrendPoint[] = prevDates.map((date, i) => ({
    date,
    value:
      typeof prevFactsWindow[i]?.sleep?.metrics?.rmssd_ms === "number"
        ? (prevFactsWindow[i] as FactsBundleV2).sleep!.metrics.rmssd_ms
        : null,
  }));
  const prevHrMax: TrendPoint[] = prevDates.map((date, i) => ({
    date,
    value:
      typeof prevFactsWindow[i]?.cardio?.metrics?.hr_max_bpm === "number"
        ? (prevFactsWindow[i] as FactsBundleV2).cardio.metrics.hr_max_bpm
        : null,
  }));

  const rhrKpiWithPrev = attachPrev(rhrKpi, prevRhr);
  const hrvKpiWithPrev = attachPrev(hrvKpi, prevHrv);
  const hrMaxKpiWithPrev = attachPrev(hrMaxKpi, prevHrMax);

  // RHR personal baseline band (last 14 days)
  const rhr14 = rhrSeries30d
    .slice(-14)
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const rhrMu = mean(rhr14);
  const rhrSd = rhrMu !== null && rhr14.length >= 7 ? stddev(rhr14, rhrMu) : null;

  // SpO2 histogram over 30 days (we only have daily means; bin into 94..100).
  const spo2Histogram: number[] = Array.from({ length: 7 }, () => 0);
  for (const p of spo2Series30d) {
    if (p.value === null) continue;
    const r = Math.round(p.value);
    if (r >= 94 && r <= 100) spo2Histogram[r - 94] += 1;
  }

  // Time-in-zone aggregate (one bucket per day's mean HR — coarse but honest)
  const zoneAccum = new Map<string, number>();
  for (const z of HR_ZONE_CUTOFFS) zoneAccum.set(z.label, 0);
  for (const p of hrAvgSeries30d) {
    if (p.value === null) continue;
    const z = HR_ZONE_CUTOFFS.find(
      (zc) => (p.value as number) >= zc.min && (p.value as number) < zc.max,
    );
    if (z) zoneAccum.set(z.label, (zoneAccum.get(z.label) ?? 0) + 1);
  }
  const zoneCounts = HR_ZONE_CUTOFFS.map((z) => ({
    label: z.label,
    count: zoneAccum.get(z.label) ?? 0,
  }));

  const recentDays = dates.slice(-7).map((date, idx) => {
    const i = dates.length - 7 + idx;
    const facts = factsWindow[i];
    const daily = dailyWindow[i];
    return {
      date,
      rhr:
        typeof facts?.cardio?.metrics?.rhr_day_bpm === "number"
          ? facts.cardio.metrics.rhr_day_bpm
          : null,
      hrv:
        typeof facts?.sleep?.metrics?.rmssd_ms === "number"
          ? facts.sleep.metrics.rmssd_ms
          : null,
      band: daily && !daily.abstain ? daily.verdict_band : null,
    };
  });

  return {
    anchor,
    rhrSeries30d,
    hrvSeries30d,
    hrMaxSeries30d,
    spo2Series30d,
    hrAvgSeries30d,
    rhrKpi: rhrKpiWithPrev,
    hrvKpi: hrvKpiWithPrev,
    hrMaxKpi: hrMaxKpiWithPrev,
    rhrBaseline: { mean: rhrMu, std: rhrSd, n: rhr14.length },
    spo2Histogram,
    zoneCounts,
    recentDays,
  };
}

// ─── body ──────────────────────────────────────────────────────────────────

export type BodyTrend = {
  anchor: string;
  /** Skin-temp delta series 14d. */
  skinTempSeries14d: TrendPoint[];
  /** Apnea events per night over 30d. */
  apneaSeries30d: TrendPoint[];
  /** BMI series 30d (rare but present). */
  bmiSeries30d: TrendPoint[];
  /** Skin-temp 30d for heatmap. */
  skinTempSeries30d: TrendPoint[];
  /** Skin-temp KPI (14d delta vs prior 14d). */
  skinTempKpi: TrendKpi;
};

export async function getBodyTrend(daysBack = 30): Promise<BodyTrend> {
  noStore();
  const anchor = await resolveTrendAnchor();
  const dates = buildWindowDates(anchor, daysBack);
  const prev14Dates = buildWindowDates(addDays(anchor, -14), 14);

  const [factsWindow, prevFactsWindow] = await Promise.all([
    Promise.all(dates.map((d) => readFacts(d))),
    Promise.all(prev14Dates.map((d) => readFacts(d))),
  ]);

  const skinTempSeries30d: TrendPoint[] = dates.map((date, i) => ({
    date,
    value:
      typeof factsWindow[i]?.body?.metrics?.skin_temp_delta_c === "number"
        ? (factsWindow[i] as FactsBundleV2).body.metrics.skin_temp_delta_c ??
          null
        : null,
  }));
  const skinTempSeries14d = skinTempSeries30d.slice(-14);

  const apneaSeries30d: TrendPoint[] = dates.map((date, i) => {
    const v = factsWindow[i]?.sleep?.metrics?.apnea_events_count;
    return { date, value: typeof v === "number" ? v : null };
  });

  const bmiSeries30d: TrendPoint[] = dates.map((date, i) => ({
    date,
    value:
      typeof factsWindow[i]?.body?.metrics?.bmi === "number"
        ? (factsWindow[i] as FactsBundleV2).body.metrics.bmi ?? null
        : null,
  }));

  const skinTempKpi = computeKpi(skinTempSeries14d);
  const prevSkin = prev14Dates.map((date, i) => ({
    date,
    value:
      typeof prevFactsWindow[i]?.body?.metrics?.skin_temp_delta_c === "number"
        ? (prevFactsWindow[i] as FactsBundleV2).body.metrics
            .skin_temp_delta_c ?? null
        : null,
  }));
  const skinTempKpiWithPrev = attachPrev(skinTempKpi, prevSkin);

  return {
    anchor,
    skinTempSeries14d,
    apneaSeries30d,
    bmiSeries30d,
    skinTempSeries30d,
    skinTempKpi: skinTempKpiWithPrev,
  };
}
