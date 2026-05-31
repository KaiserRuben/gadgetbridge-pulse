import { describe, expect, it } from "vitest";

import { validateNightReview } from "../validate.ts";
import type { NightReviewPackage } from "../package.ts";

function pkg(): NightReviewPackage {
  return {
    meta: {
      period_key: "2026-05-27",
      generated_at: "2026-05-27T07:30:00+02:00",
      tz: "Europe/Berlin",
      package_version: "night-review-package/v1",
    },
    tier1_snapshot: {
      computed_at: "2026-05-27T07:30:00+02:00",
      facts_now: {
        now_ms: 1748326200000,
        last_db_sample_at: "2026-05-27T07:25:00+02:00",
        data_lag_min: 5,
        sleeping_in_progress: false,
        last_workout_end_at: null,
        hr_now: 58,
      },
      kpis_today: {
        tst_min: 422,
        sleep_eff_pct: 92,
        rmssd_ms: 50,
        rhr_sleep_bpm: 56,
        rhr_day_bpm: 64,
        steps: null,
        active_kcal: null,
        stress_mean: null,
        day_score: { value: null, band: null, reasoning: null },
        workouts: [],
      },
      kpis_14d: {
        sleep_quality_series: [],
        autonomic_balance_series: [],
        volume_load_series: [],
        day_score_series: [],
      },
      context: {
        day_of_week: "wed",
        is_weekend: false,
        plan_session_today: null,
        pain_flags_active: [],
        anomalies_today: [],
      },
    },
    prior: {},
    domain: {
      today_summary: {
        tst_min: 422,
        sleep_efficiency_pct: 92,
        rem_min: 88,
        deep_min: 62,
        light_min: 252,
        awake_min: 20,
        rhr_sleep_bpm: 56,
        rmssd_ms: 50,
        spo2_min_pct: 90,
        breath_rate_mean: 14,
        sleep_latency_min: 9,
        wake_count: 3,
        bedtime_iso: "2026-05-26T23:00:00+02:00",
        wake_iso: "2026-05-27T06:32:00+02:00",
        midpoint_min: 293,
        tib_min: 452,
        coverage_pct: 95,
      },
      stages_timeline: [],
      hr_5min: [],
      spo2_5min: [],
      last_2_nights: [
        { date: "2026-05-26", tst_min: 466, sleep_efficiency_pct: 95, rem_min: 95, deep_min: 70, awake_min: 18, rhr_sleep_bpm: 54, rmssd_ms: 70, sleep_latency_min: 7, midpoint_min: 391 },
        { date: "2026-05-25", tst_min: 480, sleep_efficiency_pct: 96, rem_min: 100, deep_min: 75, awake_min: 16, rhr_sleep_bpm: 53, rmssd_ms: 72, sleep_latency_min: 6, midpoint_min: 413 },
      ],
      days_3_to_7: [],
      baselines_30d: {
        tst_min: { median: 466, mad: 35, n: 28 },
        rmssd_ms: { median: 70, mad: 8, n: 28 },
      },
      deltas_today: {
        tst_min: { value: 422, delta_abs: -44, delta_pct: -9.4, z_score: -0.7, band: "within" },
        rmssd_ms: { value: 50, delta_abs: -20, delta_pct: -28.6, z_score: -2.7, band: "high" },
      },
      workout_context: { yesterday_workouts: [] },
      stress_context: { yesterday: { mean: 38, max: 72, high_stress_min: 22 } },
      data_quality: {
        wear_hours_today: 22,
        missing_nights_in_7d: 0,
        signal_issues: [],
      },
    },
  };
}

const VALID_OUTPUT = JSON.stringify({
  schema_version: "night-review/v1",
  language: "de",
  incomplete: false,
  abstain: false,
  abstain_reason: null,
  headline: "Solide Nacht mit gedämpfter HRV",
  summary_short: "TST 422 min, Effizienz 92%. RMSSD 50 ms, z=-2.7.",
  summary_long: "TST 422 min (-44 vs Median 466). RMSSD 50 ms unter Baseline 70 ms (z=-2.7). Mittelpunkt 293 min vs gestern 391 min.",
  analysis_today:
    "TST 422 min, Effizienz 92%, Latenz 9 min. Stadien-Verteilung: Deep 62 min, REM 88 min, Awake 20 min.",
  analysis_context:
    "vs Median: TST -44 min (z=-0.7, innerhalb). RMSSD 50 ms vs Median 70 ms (z=-2.7, deutlich unten). Mittelpunkt 293 min vs gestern 391 min — ~98 min früher.",
  suggestions_today: [
    {
      reasoning: "RMSSD 50 ms liegt z=-2.7 unter Median 70 ms, autonom gedämpft heute.",
      anchor: "RMSSD 50 ms, z=-2.7",
      tiny: "Heute keine harten Intervalle, Easy oder Ruhe.",
      why: "Niedrige HRV deutet auf reduzierte Belastungstoleranz hin.",
      horizon: "today",
    },
  ],
  kpis: [
    {
      reasoning: "Effizienz 92% solide, Latenz 9 min sehr gut, aber 20 min Awake leicht erhöht.",
      id: "sleep_quality",
      label_de: "Schlafqualität",
      value: 78,
      band: "steady",
    },
    {
      reasoning: "RMSSD 50 ms vs Baseline 70 ms (z=-2.7) — Bereitschaft klar reduziert.",
      id: "recovery_readiness",
      label_de: "Erholung",
      value: 42,
      band: "below_usual",
    },
    {
      reasoning: "Mittelpunkt 293 min vs gestern 391 min, Verschiebung 98 min — Konsistenz schwach.",
      id: "sleep_consistency",
      label_de: "Konsistenz",
      value: 38,
      band: "below_usual",
    },
  ],
  confidence: {
    value: 0.78,
    reasoning: "Wear 22 h, 0 fehlende Nächte in 7 d, vollständige Stage-Daten.",
  },
});

const UNGROUNDED_OUTPUT = JSON.stringify({
  schema_version: "night-review/v1",
  language: "de",
  incomplete: false,
  abstain: false,
  abstain_reason: null,
  headline: "Test",
  summary_short: "TST 999 min — eindeutig erfunden.",
  summary_long: "Erfundene Zahl 1234567 in der Prosa.",
  analysis_today: "TST 422 min ok.",
  analysis_context: "RMSSD 50 ms ok.",
  suggestions_today: [],
  kpis: [
    { reasoning: "Effizienz 92% solide, daher steady — Wert konstruiert.", id: "sleep_quality", label_de: "Schlafqualität", value: 78, band: "steady" },
    { reasoning: "RMSSD 50 ms vs 70 ms — Bereitschaft reduziert klar.", id: "recovery_readiness", label_de: "Erholung", value: 42, band: "below_usual" },
    { reasoning: "Mittelpunkt 293 min vs 391 min — Konsistenz schwach klar.", id: "sleep_consistency", label_de: "Konsistenz", value: 38, band: "below_usual" },
  ],
  confidence: { value: 0.7, reasoning: "Wear 22 h, 0 fehlende Nächte in 7 d voller Daten." },
});

describe("validateNightReview", () => {
  it("passes a valid grounded output", () => {
    const result = validateNightReview(VALID_OUTPUT, pkg());
    expect(result.schemaErrors).toEqual([]);
    expect(result.groundingErrors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags ungrounded numbers in prose", () => {
    const result = validateNightReview(UNGROUNDED_OUTPUT, pkg());
    expect(result.schemaValid).toBe(true);
    expect(result.groundingErrors.length).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  it("flags missing required KPIs", () => {
    const broken = JSON.stringify({
      ...JSON.parse(VALID_OUTPUT),
      kpis: [],
    });
    const result = validateNightReview(broken, pkg());
    expect(result.schemaValid).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("accepts abstain shape when data thin", () => {
    const abstain = JSON.stringify({
      schema_version: "night-review/v1",
      language: "de",
      incomplete: false,
      abstain: true,
      abstain_reason: "Tragezeit < 6h, wear_hours_today=4",
      headline: null,
      summary_short: null,
      summary_long: null,
      analysis_today: null,
      analysis_context: null,
      suggestions_today: [],
      kpis: [
        { reasoning: "Datenmangel: wear_hours_today=4, keine Aussage möglich.", id: "sleep_quality", label_de: "Schlafqualität", value: 50, band: "steady" },
        { reasoning: "Datenmangel: wear_hours_today=4, keine Aussage möglich.", id: "recovery_readiness", label_de: "Erholung", value: 50, band: "steady" },
        { reasoning: "Datenmangel: wear_hours_today=4, keine Aussage möglich.", id: "sleep_consistency", label_de: "Konsistenz", value: 50, band: "steady" },
      ],
      confidence: { value: 0.2, reasoning: "Tragezeit < 6h, wear_hours_today=4, kein Vergleich." },
    });
    const thinPkg = pkg();
    thinPkg.domain.data_quality.wear_hours_today = 4;
    const result = validateNightReview(abstain, thinPkg);
    expect(result.schemaErrors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
