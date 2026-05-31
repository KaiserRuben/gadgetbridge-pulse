/**
 * dispatchSlot — end-to-end smoke for the morning_briefing slot.
 *
 * morning_briefing reads the prior night_review payload from the writer
 * (no DB), so this test seeds a view-state file with night_review = fresh,
 * stubs the LLM invoker to return a valid morning_briefing payload, and
 * asserts a fresh SlotDiff comes back.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { dispatchSlot } from "../dispatch.ts";
import { ViewStateWriter } from "../../view-state/writer.ts";
import type { Tier1 } from "../../types.ts";
import type { OllamaResult } from "../../../ollama.ts";

let root: string;
let writer: ViewStateWriter;
const now = new Date("2026-05-27T08:05:00+02:00");

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pulse-v4-dispatch-"));
  writer = new ViewStateWriter({ view_root: root, now: () => now });

  // Seed the daily view with a fresh night_review.
  const initial = await writer.readOrInit("daily", "2026-05-27");
  await writer.applySlot({
    scope: "daily",
    period_key: "2026-05-27",
    slot_id: "night_review",
    expected_version: initial.version,
    entry: {
      slot_id: "night_review",
      status: "fresh",
      scheduled_for: "2026-05-27T07:00:00+02:00",
      ttl_ms: 22 * 3600_000,
      computed_at: "2026-05-27T07:30:00+02:00",
      computed_by: {
        model: "qwen3.6:latest",
        slot_version: "night-review/v1",
        prompt_version: "p1-night-review",
      },
      payload: {
        schema_version: "night-review/v1",
        language: "de",
        incomplete: false,
        abstain: false,
        abstain_reason: null,
        headline: "Solide Nacht",
        summary_short: "TST 422 min.",
        summary_long: "TST 422 min, RMSSD 50 ms.",
        analysis_today: "Stadien OK.",
        analysis_context: "z=-2.7.",
        suggestions_today: [],
        kpis: [
          { reasoning: "Effizienz 92% solide.", id: "sleep_quality", label_de: "Schlafqualität", value: 78, band: "steady" },
          { reasoning: "RMSSD 50 ms vs 70 ms.", id: "recovery_readiness", label_de: "Erholung", value: 42, band: "below_usual" },
          { reasoning: "Mittelpunkt 293 min vs 391 min.", id: "sleep_consistency", label_de: "Konsistenz", value: 38, band: "below_usual" },
        ],
        confidence: { value: 0.78, reasoning: "Wear 22h, vollständige Daten." },
      },
      inputs_used: null,
      error: null,
      degraded_reason: null,
      request_count: 1,
      version: 0,
    },
  });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const tier1: Tier1 = {
  computed_at: "2026-05-27T08:05:00+02:00",
  facts_now: {
    now_ms: now.getTime(),
    last_db_sample_at: "2026-05-27T08:00:00+02:00",
    data_lag_min: 5,
    sleeping_in_progress: false,
    last_workout_end_at: null,
    hr_now: 62,
  },
  kpis_today: {
    tst_min: 422, sleep_eff_pct: 92, rmssd_ms: 50,
    rhr_sleep_bpm: 56, rhr_day_bpm: 64,
    steps: 800, active_kcal: 45, stress_mean: null,
    day_score: { value: null, band: null, reasoning: null },
    workouts: [],
  },
  kpis_14d: {
    sleep_quality_series: [], autonomic_balance_series: [],
    volume_load_series: [], day_score_series: [],
  },
  context: {
    day_of_week: "wed",
    is_weekend: false,
    plan_session_today: { template_id: "tempo_45", kind: "run", intensity: "hard", duration_min: 45 },
    pain_flags_active: [],
    anomalies_today: [],
  },
};

function morningOutput(): string {
  return JSON.stringify({
    schema_version: "morning-briefing/v1",
    language: "de",
    incomplete: false,
    abstain: false,
    abstain_reason: null,
    headline: "Erholung 42 — Plan reduzieren",
    summary_short: "RMSSD 50 ms, Erholung 42.",
    summary_long: "TST 422 min, Erholung 42/100 (RMSSD 50 ms, z=-2.7).",
    focus_today: "Erholung priorisieren — Easy statt hartem Tempo bei Erholung 42.",
    plan_adherence: {
      status: "modify",
      reasoning: "Erholung 42 (band=below_usual), RMSSD 50 ms — Intensität von hart auf moderate.",
      recommendation: "45 min Easy statt Intervalle.",
    },
    suggestions_today: [
      {
        reasoning: "RMSSD 50 ms unter Baseline, autonom heute reduziert — leichte Aktivierung.",
        anchor: "RMSSD 50 ms",
        tiny: "10 min Mobility vor dem Lauf.",
        why: "Sanfter Sympathikus-Anstieg ohne HRV-Drop.",
        horizon: "morning",
      },
    ],
    confidence: { value: 0.72, reasoning: "night_review fresh (computed 35 min her), Plan klar tempo_45." },
  });
}

describe("dispatchSlot", () => {
  it("produces a fresh diff for morning_briefing with stubbed LLM", async () => {
    const result = await dispatchSlot({
      slot_id: "morning_briefing",
      ctx: {
        period_key: "2026-05-27",
        scope: "daily",
        tz: "Europe/Berlin",
        db: { prepare: () => ({ get: () => null, all: () => [] }) } as never, // no DB needed
        insights_root: path.join(root, "insights"),
        view_root: root,
        tier1,
        now,
      },
      expected_view_version: 1,
      existing: null,
      ttl_ms: 6 * 3600_000,
      scheduled_for: "2026-05-27T08:05:00+02:00",
      invoker: async (): Promise<OllamaResult> => ({
        content: morningOutput(),
        totalMs: 10,
        promptTokens: 0,
        evalTokens: 0,
        endpoint: "local",
        endpointUrl: "test",
      }),
    });

    expect(result.diff.slot_id).toBe("morning_briefing");
    expect(result.diff.entry.status).toBe("fresh");
    expect(result.diff.entry.payload).not.toBeNull();
    expect(result.attempts).toBe(1);
  });

  it("marks errored when LLM emits invalid JSON", async () => {
    const result = await dispatchSlot({
      slot_id: "morning_briefing",
      ctx: {
        period_key: "2026-05-27",
        scope: "daily",
        tz: "Europe/Berlin",
        db: { prepare: () => ({ get: () => null, all: () => [] }) } as never,
        insights_root: path.join(root, "insights"),
        view_root: root,
        tier1,
        now,
      },
      expected_view_version: 1,
      existing: null,
      ttl_ms: 6 * 3600_000,
      scheduled_for: "2026-05-27T08:05:00+02:00",
      invoker: async (): Promise<OllamaResult> => ({
        content: "not json at all",
        totalMs: 10,
        promptTokens: 0,
        evalTokens: 0,
        endpoint: "local",
        endpointUrl: "test",
      }),
    });
    expect(result.diff.entry.status).toBe("errored");
    expect(result.diff.entry.error?.retry_after_ms).toBeGreaterThan(0);
  });
});
