/**
 * Fixture-based tests for the rule engine top-level.
 *
 * Each fixture builds a complete `RuleEngineInput` and asserts on the
 * engine's `RuleEngineOutput`. Fixtures are self-contained — no I/O.
 *
 * Three minimum fixtures (per P2 plan):
 *   1. rhr_drift_rising   → S2 "rhr_drift_rising" observation
 *   2. cold_start         → cold_start_active, no S2 firing
 *   3. nothing_notable    → abstain=true, nothing_notable observation
 */

import { describe, it, expect } from "vitest";
import { runRuleEngine } from "../engine.ts";
import type {
  AlarmStateV1,
  PauseInputs,
  RuleEngineInput,
  RuleHistory,
  FactsBundleV2,
} from "../types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────────

function emptyAlarmState(): AlarmStateV1 {
  return {
    schema_version: "state/v1",
    snooze_until: {},
    dismissed_counts: {},
    muted_topics: [],
  };
}

function defaultPause(): PauseInputs {
  return {
    paused: false,
    i_feel_fine: false,
    step_change_detected_on: null,
  };
}

function baseFacts(): FactsBundleV2 {
  return {
    schema_version: "facts/v2",
    period_key: "2026-05-08",
    generated_at: "2026-05-08T08:00:00.000Z",
    data_window: {
      start_iso: "2026-05-07T00:00:00.000Z",
      end_iso: "2026-05-08T08:00:00.000Z",
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
    device: {
      model: "Mi Band 8",
      firmware: "1.7.0",
      wear_seconds_24h: 80000, // 92.6%, well above 80%
    },
    sleep: {
      metrics: {
        tst_min: 440, // healthy
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
      metrics: {
        rhr_day_bpm: 60,
        hr_max_bpm: 110,
        hr_mean_bpm: 75,
        spo2_mean_pct: 96,
      },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    activity: {
      metrics: {
        steps: 9000,
        active_minutes: 45,
        sedentary_minutes: 600,
        calories_kcal: 2400,
      },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    stress: {
      metrics: {
        stress_mean: 35,
        stress_max: 70,
        high_stress_minutes: 60,
      },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    body: {
      metrics: { weight_kg: null, body_fat_pct: null, bmi: null },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    anomalies: {
      hr_overflow_rows: 0,
      negative_step_rows: 0,
      data_notes: [],
    },
    workouts: null,
    ecg: null,
    journal: null,
    meal: null,
    cycle: null,
  };
}

/**
 * Stable history with all metrics held constant across the window. Constant
 * series keep MAD/CV at 0, which the rule helpers treat as "no signal" and
 * suppress (sentinel returns 0 for zRobust). This is what we want for a
 * truly quiet day — the engine should abstain.
 */
function stableHistory(): RuleHistory {
  return {
    rhr_day_bpm_30d: Array.from({ length: 30 }, () => 60),
    rhr_sleep_bpm_30d: Array.from({ length: 30 }, () => 56),
    rmssd_ms_30d: Array.from({ length: 30 }, () => 50),
    tst_min_30d: Array.from({ length: 30 }, () => 440),
    sleep_efficiency_pct_30d: Array.from({ length: 30 }, () => 90),
    sleep_latency_min_30d: Array.from({ length: 30 }, () => 12),
    apnea_events_per_night_14d: Array.from({ length: 14 }, () => 0),
    apnea_max_level_14d: Array.from({ length: 14 }, () => 0),
    deep_plus_rem_min_14d: Array.from({ length: 14 }, () => 165),
    skin_temp_delta_c_14d: Array.from({ length: 14 }, () => 0),
    steps_30d: Array.from({ length: 30 }, () => 9000),
    sedentary_blocks_90min_14d: Array.from({ length: 14 }, () => 1),
    stress_high_pct_7d: Array.from({ length: 7 }, () => 10),
    bedtime_min_7d: Array.from({ length: 7 }, () => 1380), // 23:00 → SRI ≈ 100
    total_nights_observed: 30,
    last_firmware_change_iso: null,
    recent_dst_transition_iso: null,
  };
}

function makeInput(overrides: Partial<RuleEngineInput> = {}): RuleEngineInput {
  return {
    facts: baseFacts(),
    history: stableHistory(),
    alarmState: emptyAlarmState(),
    pause: defaultPause(),
    currentLocalTime: "2026-05-08T08:30:00",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture 1: rhr_drift_rising
// ─────────────────────────────────────────────────────────────────────────────

describe("rhr_drift_rising fixture", () => {
  it("emits rhr_drift_rising S2 observation when RHR climbs over 14 days", () => {
    // 30 nights baseline of low RHR around 56, then 14 days climbing.
    const baseline = Array.from({ length: 16 }, () => 56);
    const rising = [56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69];
    const rhrSeries = [...baseline, ...rising];

    const facts = baseFacts();
    facts.cardio.metrics.rhr_day_bpm = 69;
    facts.cardio.metrics.hr_max_bpm = 105; // below 120 — no S1

    const input = makeInput({
      facts,
      history: {
        ...stableHistory(),
        rhr_day_bpm_30d: rhrSeries,
        total_nights_observed: 30,
      },
    });

    const out = runRuleEngine(input);
    const drift = out.observations.find((o) => o.id === "rhr_drift_rising");
    expect(drift).toBeDefined();
    expect(drift?.tier).toBe("S2");
    expect(drift?.direction).toBe("up");
    expect(out.abstain).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixture 2: cold start
// ─────────────────────────────────────────────────────────────────────────────

describe("cold_start fixture", () => {
  it("emits cold_start_active and suppresses S2 pattern alarms", () => {
    // Only 5 nights of data, but the rising-RHR pattern shouldn't fire S2.
    const rising = [56, 60, 62, 65, 68];
    const facts = baseFacts();
    facts.cardio.metrics.rhr_day_bpm = 68;
    facts.cardio.metrics.hr_max_bpm = 100;

    const input = makeInput({
      facts,
      history: {
        ...stableHistory(),
        rhr_day_bpm_30d: rising,
        total_nights_observed: 5,
      },
    });

    const out = runRuleEngine(input);

    const cold = out.observations.find((o) => o.id === "cold_start_active");
    expect(cold).toBeDefined();
    expect(cold?.tier).toBeNull();

    // No S2 pattern alarms despite the rising data.
    const s2 = out.observations.filter((o) => o.tier === "S2");
    expect(s2).toHaveLength(0);
  });

  it("still fires S1 absolute thresholds during cold start", () => {
    const facts = baseFacts();
    facts.cardio.metrics.hr_max_bpm = 135; // > 120 → S1
    facts.sleep!.metrics.spo2_min_pct = 86; // < 88 → S1

    const input = makeInput({
      facts,
      history: { ...stableHistory(), total_nights_observed: 3 },
    });

    const out = runRuleEngine(input);
    const tach = out.observations.find((o) => o.id === "rhr_tachycardia_safety");
    const spo2 = out.observations.find((o) => o.id === "spo2_critical_low");
    expect(tach).toBeDefined();
    expect(tach?.tier).toBe("S1");
    expect(spo2).toBeDefined();
    expect(spo2?.tier).toBe("S1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixture 3: nothing_notable
// ─────────────────────────────────────────────────────────────────────────────

describe("nothing_notable fixture", () => {
  it("abstains and emits nothing_notable when all metrics are within range", () => {
    const out = runRuleEngine(makeInput());
    expect(out.abstain).toBe(true);
    expect(out.abstain_reason).not.toBeNull();
    expect(out.observations.find((o) => o.id === "nothing_notable")).toBeDefined();
    // No tiered observations should be present.
    expect(out.observations.filter((o) => o.tier !== null)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: anti-orthosomnia gate
// ─────────────────────────────────────────────────────────────────────────────

describe("anti-orthosomnia window", () => {
  it("suppresses sleep observations in the morning window (< 10:00 local)", () => {
    // Build a fixture that would fire a sleep S2 (low TST pattern), then
    // assert the suppression tag appears in the morning (< 10:00) but not
    // afterwards. Morning anxiety amplifies sleep-data interpretation per
    // Baron 2017 / Bergen Orthosomnia Scale 2025.
    const lowTst = Array.from({ length: 30 }, () => 440);
    // Make the last 3 nights very low → 3-consec ≤ -1.5σ.
    lowTst[27] = 200;
    lowTst[28] = 210;
    lowTst[29] = 220;

    const facts = baseFacts();
    facts.sleep!.metrics.tst_min = 220;

    const morningInput = makeInput({
      facts,
      history: {
        ...stableHistory(),
        tst_min_30d: lowTst,
      },
      currentLocalTime: "2026-05-08T08:00:00",
    });
    const morning = runRuleEngine(morningInput);
    const tstMorning = morning.observations.find((o) =>
      o.id.startsWith("sleep_total_time"),
    );
    expect(tstMorning).toBeDefined();
    expect(tstMorning?.suppressed_by ?? []).toContain("anti_orthosomnia_window");

    const afternoonInput = makeInput({
      facts,
      history: {
        ...stableHistory(),
        tst_min_30d: lowTst,
      },
      currentLocalTime: "2026-05-08T14:00:00",
    });
    const afternoon = runRuleEngine(afternoonInput);
    const tstPm = afternoon.observations.find((o) =>
      o.id.startsWith("sleep_total_time"),
    );
    expect(tstPm).toBeDefined();
    expect(tstPm?.suppressed_by ?? []).not.toContain("anti_orthosomnia_window");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: i_feel_fine suppresses S2 but not S1
// ─────────────────────────────────────────────────────────────────────────────

describe("i_feel_fine override", () => {
  it("suppresses S2 but never S1", () => {
    const facts = baseFacts();
    facts.cardio.metrics.hr_max_bpm = 130; // S1
    // Construct an S2 RHR drift in parallel.
    const rising = [
      ...Array.from({ length: 16 }, () => 56),
      56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    ];

    const input = makeInput({
      facts,
      history: {
        ...stableHistory(),
        rhr_day_bpm_30d: rising,
      },
      pause: { ...defaultPause(), i_feel_fine: true },
    });
    const out = runRuleEngine(input);

    const s1 = out.observations.find((o) => o.id === "rhr_tachycardia_safety");
    const s2 = out.observations.find((o) => o.id === "rhr_drift_rising");
    expect(s1).toBeDefined();
    expect(s1?.suppressed_by ?? []).not.toContain("i_feel_fine");
    expect(s2).toBeDefined();
    expect(s2?.suppressed_by ?? []).toContain("i_feel_fine");
  });
});
