import { describe, expect, it } from "vitest";

import { validateMorningBriefing } from "../validate.ts";
import type { MorningBriefingPackage } from "../package.ts";

function pkg(): MorningBriefingPackage {
  return {
    meta: {
      period_key: "2026-05-27",
      generated_at: "2026-05-27T08:05:00+02:00",
      tz: "Europe/Berlin",
      package_version: "morning-briefing-package/v1",
    },
    tier1_snapshot: {
      computed_at: "2026-05-27T08:05:00+02:00",
      facts_now: {
        now_ms: 1748326500000,
        last_db_sample_at: "2026-05-27T08:00:00+02:00",
        data_lag_min: 5,
        sleeping_in_progress: false,
        last_workout_end_at: null,
        hr_now: 62,
      },
      kpis_today: {
        tst_min: 422,
        sleep_eff_pct: 92,
        rmssd_ms: 50,
        rhr_sleep_bpm: 56,
        rhr_day_bpm: 64,
        steps: 800,
        active_kcal: 45,
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
        plan_session_today: {
          template_id: "tempo_45",
          kind: "run",
          intensity: "hard",
          duration_min: 45,
        },
        pain_flags_active: [],
        anomalies_today: [],
      },
    },
    prior: {
      night_review: {
        slot_id: "night_review",
        status: "fresh",
        computed_at: "2026-05-27T07:35:00+02:00",
        payload: {
          schema_version: "night-review/v1",
          language: "de",
          incomplete: false,
          abstain: false,
          abstain_reason: null,
          headline: "Solide Nacht mit gedämpfter HRV",
          summary_short: "TST 422 min, RMSSD 50 ms.",
          summary_long: "TST 422 min, Effizienz 92%, RMSSD 50 ms vs 70 ms.",
          analysis_today: "Stadien-Verteilung Deep 62 min, REM 88 min.",
          analysis_context: "z=-2.7 für RMSSD, klar unten.",
          suggestions_today: [],
          kpis: [
            { reasoning: "Effizienz 92%, Latenz 9 min — solide Nacht.", id: "sleep_quality", label_de: "Schlafqualität", value: 78, band: "steady" },
            { reasoning: "RMSSD 50 ms vs Median 70 ms, z=-2.7 — klar reduziert.", id: "recovery_readiness", label_de: "Erholung", value: 42, band: "below_usual" },
            { reasoning: "Mittelpunkt 293 min vs gestern 391 min, -98 min Verschiebung.", id: "sleep_consistency", label_de: "Konsistenz", value: 38, band: "below_usual" },
          ],
          confidence: { value: 0.78, reasoning: "Wear 22 h, 0 fehlende Nächte in 7 d." },
        },
      },
    },
    domain: {
      morning_window: {
        generated_at_iso: "2026-05-27T08:05:00+02:00",
        local_hour: 8,
        minutes_since_wake: null,
        late_start: false,
      },
    },
  };
}

const VALID_OUTPUT = JSON.stringify({
  schema_version: "morning-briefing/v1",
  language: "de",
  incomplete: false,
  abstain: false,
  abstain_reason: null,
  headline: "Erholung 42 — heute Plan reduzieren",
  summary_short: "RMSSD 50 ms, recovery_readiness 42. Plan tempo_45 modifizieren.",
  summary_long: "Nacht solide (TST 422 min), Erholung aber 42/100 (RMSSD 50 ms, z=-2.7). Heute steht tempo_45 — Intensität reduzieren empfohlen.",
  focus_today: "Erholung priorisieren — Easy statt hartem Tempo, da Erholungs-KPI 42 unter Schwelle.",
  plan_adherence: {
    status: "modify",
    reasoning: "recovery_readiness 42 (band=below_usual), RMSSD z=-2.7 — Plan ja, aber Intensität von hart auf moderate.",
    recommendation: "45 min Easy-Run statt Intervalle.",
  },
  suggestions_today: [
    {
      reasoning: "RMSSD 50 ms unter Baseline, autonom heute reduziert — leichte Aktivierung statt Pushen.",
      anchor: "RMSSD 50 ms, z=-2.7",
      tiny: "10 min Mobility vor dem Lauf.",
      why: "Sanfter Sympathikus-Anstieg ohne HRV-Drop.",
      horizon: "morning",
    },
  ],
  confidence: {
    value: 0.72,
    reasoning: "night_review fresh (computed 30 min her), Plan klar tempo_45, eindeutige Signale aus 50 ms RMSSD.",
  },
});

describe("validateMorningBriefing", () => {
  it("passes valid grounded output", () => {
    const result = validateMorningBriefing(VALID_OUTPUT, pkg());
    expect(result.schemaErrors).toEqual([]);
    expect(result.groundingErrors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags missing plan_adherence", () => {
    const broken = JSON.stringify({
      ...JSON.parse(VALID_OUTPUT),
      plan_adherence: undefined,
    });
    const result = validateMorningBriefing(broken, pkg());
    expect(result.schemaValid).toBe(false);
  });
});
