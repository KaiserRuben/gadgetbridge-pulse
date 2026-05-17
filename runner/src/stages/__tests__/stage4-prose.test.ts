/**
 * Tests for Stage 4 — prose draft.
 *
 * Mocks `callOllama` so the suite runs offline. Verifies:
 *   - Happy path: schema-valid response → returned as-is
 *   - i_feel_fine_override is overwritten from pause state
 *   - Schema-invalid response retries up to 3 times then abstains
 *   - Temperature decay 0.15 → 0.10 → 0.05 across attempts
 *   - HTTP error path also exhausts retries and abstains
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";
import type { Observation } from "@/lib/types/observations";

// Hoisted mock — Vitest allows this top-level import-mock with vi.mock.
vi.mock("../../ollama.ts", () => ({
  callOllama: vi.fn(),
}));

// Import AFTER vi.mock so the module under test picks up the mocked symbol.
import { callOllama } from "../../ollama.ts";
import { runStage4 } from "../stage4-prose.ts";
import type { PickedEvidence } from "../stage3-evidence.ts";

const mockOllama = callOllama as unknown as ReturnType<typeof vi.fn>;

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
      sleep_rows: 0,
      hr_rows: 0,
      spo2_rows: 0,
      stress_rows: 0,
      step_rows: 0,
      weight_rows: 0,
    },
    user: { age: 32, sex: "m", height_cm: 180 },
    device: { model: "Mi Band 8", firmware: "1.7.0", wear_seconds_24h: 80000 },
    sleep: {
      metrics: {
        tst_min: null,
        sleep_efficiency_pct: null,
        rem_min: null,
        deep_min: null,
        light_min: null,
        awake_min: null,
        rhr_sleep_bpm: null,
        rmssd_ms: null,
        spo2_min_pct: null,
      },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    cardio: {
      metrics: { rhr_day_bpm: null, hr_max_bpm: null, hr_mean_bpm: null, spo2_mean_pct: null },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    activity: {
      metrics: { steps: null, active_minutes: null, sedentary_minutes: null, calories_kcal: null },
      baseline: null,
      signal_quality: { ok: true, issues: [] },
    },
    stress: {
      metrics: { stress_mean: null, stress_max: null, high_stress_minutes: null },
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

function validDaily(extra: Partial<DailyInsightV2> = {}): DailyInsightV2 {
  return {
    reasoning_trace:
      "Schritt 1: Beobachtungen leer. Schritt 2: keine Treiber. Schritt 3: keine Aktion. Schritt 4: niedriges Vertrauen.",
    schema_version: "daily/v2",
    language: "de",
    abstain: true,
    abstain_reason: "no observations",
    headline: null,
    verdict_band: null,
    summary: null,
    drivers: [],
    affirmation: null,
    reflection: null,
    action: null,
    i_feel_fine_override: false,
    confidence: { value: 0, calc: "0.000", factors: [] },
    ...extra,
  };
}

function ollamaResponse(content: string) {
  return {
    content,
    totalMs: 100,
    promptTokens: 10,
    evalTokens: 20,
  };
}

const observations: Observation[] = [];
const picked: PickedEvidence = {
  selected_ids: [],
  ids: [],
  rationale: "",
  used_fallback: false,
};

beforeEach(() => {
  mockOllama.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("stage4 — happy path", () => {
  it("returns the parsed daily on first attempt", async () => {
    mockOllama.mockResolvedValueOnce(
      ollamaResponse(JSON.stringify(validDaily())),
    );

    const result = await runStage4(
      baseFacts(),
      observations,
      picked,
      [],
      { i_feel_fine: false },
    );

    expect(result.used_abstain_fallback).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.daily.schema_version).toBe("daily/v2");
    expect(result.daily.abstain).toBe(true);
    expect(mockOllama).toHaveBeenCalledTimes(1);
  });

  it("overrides i_feel_fine_override from pause state", async () => {
    mockOllama.mockResolvedValueOnce(
      ollamaResponse(
        JSON.stringify(validDaily({ i_feel_fine_override: false })),
      ),
    );

    const result = await runStage4(
      baseFacts(),
      observations,
      picked,
      [],
      { i_feel_fine: true },
    );

    expect(result.daily.i_feel_fine_override).toBe(true);
  });
});

describe("stage4 — retry on schema fail", () => {
  it("retries up to 3 times then abstains", async () => {
    mockOllama.mockResolvedValue(ollamaResponse('{"not":"valid"}'));

    const result = await runStage4(
      baseFacts(),
      observations,
      picked,
      [],
      { i_feel_fine: false },
    );

    expect(result.used_abstain_fallback).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.daily.abstain).toBe(true);
    expect(result.daily.abstain_reason).toBe("llm_schema_fail");
    expect(result.daily.headline).toBeNull();
    expect(result.daily.summary).toBeNull();
    expect(result.daily.drivers).toEqual([]);
    expect(result.daily.action).toBeNull();
    expect(mockOllama).toHaveBeenCalledTimes(3);
  });

  it("decays temperature 0.15 → 0.10 → 0.05 across attempts", async () => {
    mockOllama.mockResolvedValue(ollamaResponse('"not even an object"'));

    await runStage4(
      baseFacts(),
      observations,
      picked,
      [],
      { i_feel_fine: false },
    );

    const calls = mockOllama.mock.calls;
    expect(calls.length).toBe(3);
    expect(calls[0][0].options.temperature).toBe(0.15);
    expect(calls[1][0].options.temperature).toBe(0.1);
    expect(calls[2][0].options.temperature).toBe(0.05);
  });

  it("succeeds on second attempt if first returns garbage", async () => {
    mockOllama
      .mockResolvedValueOnce(ollamaResponse("totally not json"))
      .mockResolvedValueOnce(ollamaResponse(JSON.stringify(validDaily())));

    const result = await runStage4(
      baseFacts(),
      observations,
      picked,
      [],
      { i_feel_fine: false },
    );

    expect(result.used_abstain_fallback).toBe(false);
    expect(result.attempts).toBe(2);
    expect(mockOllama).toHaveBeenCalledTimes(2);
  });
});

describe("stage4 — HTTP error path", () => {
  it("treats HTTP errors as a retryable failure and eventually abstains", async () => {
    mockOllama.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await runStage4(
      baseFacts(),
      observations,
      picked,
      [],
      { i_feel_fine: false },
    );

    expect(result.used_abstain_fallback).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.daily.abstain_reason).toBe("llm_schema_fail");
    expect(mockOllama).toHaveBeenCalledTimes(3);
  });
});
