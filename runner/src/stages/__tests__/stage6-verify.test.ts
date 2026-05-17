/**
 * Tests for the Stage 6 verifier.
 *
 * Covers:
 *   - AJV schema accept / reject
 *   - Confidence-math edge cases (within tolerance, outside tolerance)
 *   - Number-in-facts grounding (rounded match, missing match)
 *   - claim_id linkage warnings
 *   - Forbidden-pattern detection (F1–F12 + autonomy from prose architect)
 */

import { describe, it, expect } from "vitest";

import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";
import type { Observation } from "@/lib/types/observations";
import { verify } from "../stage6-verify.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function baseFacts(): FactsBundleV2 {
  return {
    schema_version: "facts/v2",
    period_key: "2026-05-08",
    generated_at: "2026-05-08T08:00:00.000Z",
    data_window: {
      start_iso: "2026-05-08T00:00:00.000Z",
      end_iso: "2026-05-09T00:00:00.000Z",
      tz: "Europe/Berlin",
    },
    samples_seen: {
      sleep_rows: 480,
      hr_rows: 1440,
      spo2_rows: 12,
      stress_rows: 96,
      step_rows: 1440,
      weight_rows: 0,
    },
    user: { age: 32, sex: "m", height_cm: 180 },
    device: { model: "Mi Band 8", firmware: "1.7.0", wear_seconds_24h: 80000 },
    sleep: {
      metrics: {
        tst_min: 440,
        sleep_efficiency_pct: 90,
        rem_min: 95,
        deep_min: 70,
        light_min: 250,
        awake_min: 25,
        rhr_sleep_bpm: 56,
        rmssd_ms: 50,
        spo2_min_pct: 95,
      },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    cardio: {
      metrics: { rhr_day_bpm: 60, hr_max_bpm: 110, hr_mean_bpm: 75, spo2_mean_pct: 96 },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    activity: {
      metrics: { steps: 9000, active_minutes: 45, sedentary_minutes: 600, calories_kcal: 2400 },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    stress: {
      metrics: { stress_mean: 35, stress_max: 70, high_stress_minutes: 60 },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    body: {
      metrics: { weight_kg: null, body_fat_pct: null, bmi: null },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    anomalies: { hr_overflow_rows: 0, negative_step_rows: 0, data_notes: [] },
    workouts: null,
    ecg: null,
    journal: null,
    meal: null,
    cycle: null,
  };
}

function abstainingDaily(): DailyInsightV2 {
  return {
    reasoning_trace: "[stub] P3 deterministic-only run; abstain=true; observations=0; surfaced=none ".padEnd(80, " "),
    schema_version: "daily/v2",
    language: "de",
    abstain: true,
    abstain_reason: "P3-stub: LLM not wired yet",
    headline: null,
    verdict_band: null,
    summary: null,
    drivers: [],
    affirmation: null,
    reflection: null,
    action: null,
    i_feel_fine_override: false,
    confidence: { value: 0, calc: "0.000", factors: [] },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AJV layer
// ─────────────────────────────────────────────────────────────────────────────

describe("stage6 verify — AJV schema", () => {
  it("accepts a well-formed abstaining daily", () => {
    const result = verify(abstainingDaily(), baseFacts(), JSON.stringify(baseFacts()));
    const ajv = result.layers.find((l) => l.name === "ajv");
    expect(ajv?.ok).toBe(true);
  });

  it("rejects a daily with missing required fields", () => {
    const broken = abstainingDaily() as DailyInsightV2 & Record<string, unknown>;
    delete (broken as Record<string, unknown>)["reasoning_trace"];
    const result = verify(broken as DailyInsightV2, baseFacts(), JSON.stringify(baseFacts()));
    const ajv = result.layers.find((l) => l.name === "ajv");
    expect(ajv?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confidence math
// ─────────────────────────────────────────────────────────────────────────────

describe("stage6 verify — confidence math", () => {
  it("passes when |value - calc| < 0.05", () => {
    const d = abstainingDaily();
    d.confidence = { value: 0.5, calc: "0.51", factors: [] };
    const r = verify(d, baseFacts(), JSON.stringify(baseFacts()));
    expect(r.layers.find((l) => l.name === "confidence_math")?.ok).toBe(true);
  });

  it("fails when |value - calc| >= 0.05", () => {
    const d = abstainingDaily();
    d.confidence = { value: 0.5, calc: "0.30", factors: [] };
    const r = verify(d, baseFacts(), JSON.stringify(baseFacts()));
    expect(r.layers.find((l) => l.name === "confidence_math")?.ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("fails when calc is unparseable", () => {
    const d = abstainingDaily();
    d.confidence = { value: 0.5, calc: "n/a", factors: [] };
    const r = verify(d, baseFacts(), JSON.stringify(baseFacts()));
    expect(r.layers.find((l) => l.name === "confidence_math")?.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Numbers-in-facts
// ─────────────────────────────────────────────────────────────────────────────

describe("stage6 verify — numbers-in-facts grounding", () => {
  it("returns vacuous-OK when prose is empty", () => {
    const r = verify(abstainingDaily(), baseFacts(), JSON.stringify(baseFacts()));
    const layer = r.layers.find((l) => l.name === "numbers_in_facts");
    expect(layer?.ok).toBe(true);
  });

  it("matches numbers that appear in factsString", () => {
    const d = abstainingDaily();
    d.headline = "Ruhepuls 60 bpm";
    d.summary = "TST 440 min steht stabil.";
    const facts = baseFacts();
    const r = verify(d, facts, JSON.stringify(facts));
    const layer = r.layers.find((l) => l.name === "numbers_in_facts");
    expect(layer?.ok).toBe(true);
  });

  it("flags numbers not present in factsString (warn, not critical)", () => {
    const d = abstainingDaily();
    d.headline = "Ruhepuls 99 bpm";
    const facts = baseFacts();
    const r = verify(d, facts, JSON.stringify(facts));
    const layer = r.layers.find((l) => l.name === "numbers_in_facts");
    expect(layer?.ok).toBe(false);
    // Non-critical → overall verify still ok (no critical layer failed).
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Linkage
// ─────────────────────────────────────────────────────────────────────────────

describe("stage6 verify — claim_id linkage", () => {
  const observations: Observation[] = [
    {
      id: "rhr_drift_rising",
      domain: "heart",
      severity: "watch",
      tier: "S2",
      metric_id: "cardio.rhr_day_bpm",
      evidence: ["cardio.rhr_day_bpm"],
      window: { start_iso: "x", end_iso: "y" },
      confidence: { value: 0.7, factors: [] },
      text_for_llm: "test",
      direction: "up",
    },
  ];

  it("passes when every evidence_id maps to an observation", () => {
    const d = abstainingDaily();
    d.drivers = [
      {
        clause: "Ruhepuls steigt",
        metric_id: "cardio.rhr_day_bpm",
        delta_text: "+6 bpm",
        direction: "up",
        evidence_ids: ["rhr_drift_rising"],
      },
    ];
    const r = verify(d, baseFacts(), JSON.stringify(baseFacts()), observations);
    expect(r.layers.find((l) => l.name === "claim_id_linkage")?.ok).toBe(true);
  });

  it("flags dangling evidence_ids (warn, not critical)", () => {
    const d = abstainingDaily();
    d.drivers = [
      {
        clause: "Was?",
        metric_id: "cardio.rhr_day_bpm",
        delta_text: "+0",
        direction: "flat",
        evidence_ids: ["nonexistent_observation"],
      },
    ];
    const r = verify(d, baseFacts(), JSON.stringify(baseFacts()), observations);
    expect(r.layers.find((l) => l.name === "claim_id_linkage")?.ok).toBe(false);
    expect(r.ok).toBe(true); // non-critical
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Forbidden patterns (F1–F12 + autonomy)
// ─────────────────────────────────────────────────────────────────────────────

describe("stage6 verify — forbidden patterns", () => {
  function dailyWithText(opts: Partial<DailyInsightV2>): DailyInsightV2 {
    return { ...abstainingDaily(), ...opts };
  }

  function getLayer(d: DailyInsightV2) {
    const r = verify(d, baseFacts(), JSON.stringify(baseFacts()));
    return r.layers.find((l) => l.name === "forbidden_patterns");
  }

  it("returns vacuous-OK on empty prose", () => {
    expect(getLayer(abstainingDaily())?.ok).toBe(true);
  });

  it("F1: flags 'Schlafapnoe' diagnosis term", () => {
    const layer = getLayer(dailyWithText({ summary: "Hinweise auf Schlafapnoe heute Nacht." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F1_DIAGNOSIS");
  });

  it("F2: flags 'Magnesium' recommendation", () => {
    const layer = getLayer(dailyWithText({ summary: "Probier Magnesium am Abend." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F2_SUBSTANCE");
  });

  it("F3: flags causal sentence with two metric/value pairs", () => {
    const layer = getLayer(
      dailyWithText({ summary: "Dein Stress 70 bpm verursacht den HRV 35 ms." }),
    );
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F3_CAUSAL");
  });

  it("F4: flags 'erhöhtes Risiko für'", () => {
    const layer = getLayer(dailyWithText({ summary: "Erhöhtes Risiko für Burnout." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toMatch(/F4_RISK/);
  });

  it("F5: flags down-driver + null action + abstain=false + no 'nur zur Info'", () => {
    const d = dailyWithText({
      abstain: false,
      summary: "Ruhepuls liegt höher.",
      action: null,
      drivers: [
        {
          clause: "Ruhepuls steigt",
          metric_id: "cardio.rhr_day_bpm",
          delta_text: "+6 bpm",
          direction: "down",
          evidence_ids: ["x"],
        },
      ],
      confidence: { value: 0.4, calc: "0.40", factors: [] },
    });
    const layer = getLayer(d);
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F5_DOWN_NOACTION");
  });

  it("F5: passes when summary contains 'nur zur Info'", () => {
    const d = dailyWithText({
      abstain: false,
      summary: "Ruhepuls liegt höher — nur zur Info.",
      action: null,
      drivers: [
        {
          clause: "Ruhepuls steigt",
          metric_id: "cardio.rhr_day_bpm",
          delta_text: "+6 bpm",
          direction: "down",
          evidence_ids: ["x"],
        },
      ],
      confidence: { value: 0.4, calc: "0.40", factors: [] },
    });
    const layer = getLayer(d);
    // F5 should not fire — but other patterns shouldn't either here.
    expect(layer?.details ?? "").not.toContain("F5_DOWN_NOACTION");
  });

  it("F6: flags diagnostic 'du bist müde'", () => {
    const layer = getLayer(dailyWithText({ summary: "Du bist müde heute." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F6_DIAGNOSTIC_DU");
  });

  it("F7: flags 'großartig!'", () => {
    const layer = getLayer(dailyWithText({ summary: "Großartig! Sehr gut gemacht." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F7_PSEUDO_EMPATHY");
  });

  it("F8: flags fake memory 'letzte Woche hast du gesagt'", () => {
    const layer = getLayer(
      dailyWithText({ summary: "Letzte Woche hast du gesagt, dass du müde warst." }),
    );
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F8_FAKE_MEMORY");
  });

  it("F9: flags urgency 'DRINGEND'", () => {
    const layer = getLayer(dailyWithText({ summary: "DRINGEND mehr Schlaf nötig." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F9_URGENCY");
  });

  it("F10: flags streak manipulation", () => {
    const layer = getLayer(dailyWithText({ summary: "Wenn du heute auslässt, verlierst du deinen Streak." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F10_STREAK");
  });

  it("F11: flags compare-with-others", () => {
    const layer = getLayer(dailyWithText({ summary: "Andere Nutzer schlafen besser." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F11_COMPARE_OTHERS");
  });

  it("F12: flags bare 'dein Recovery ist 42'", () => {
    const layer = getLayer(dailyWithText({ summary: "Dein Recovery ist 42 heute Morgen." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("F12_BARE_SCORE");
  });

  it("F12: passes with 'der …' relative clause softener", () => {
    const layer = getLayer(
      dailyWithText({ summary: "Dein Recovery ist 42, der eine ruhige Nacht andeutet." }),
    );
    expect(layer?.details ?? "").not.toContain("F12_BARE_SCORE");
  });

  it("F12: passes with 'wirkt' softener", () => {
    const layer = getLayer(
      dailyWithText({ summary: "Dein Recovery ist 42 und wirkt unterhalb des Schnitts." }),
    );
    expect(layer?.details ?? "").not.toContain("F12_BARE_SCORE");
  });

  it("Autonomy: flags 'du musst'", () => {
    const layer = getLayer(dailyWithText({ summary: "Du musst früher ins Bett." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("AUTONOMY");
  });

  it("Autonomy: flags 'du solltest'", () => {
    const layer = getLayer(dailyWithText({ summary: "Du solltest mehr Wasser trinken." }));
    expect(layer?.ok).toBe(false);
    expect(layer?.details).toContain("AUTONOMY");
  });
});
