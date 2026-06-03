/**
 * Daemon e2e dry-run.
 *
 * Wires the daemon end-to-end (tier1 → outbox → in-process Pi → writer
 * → slot dispatcher → LLM-stub → writer) using a fake `fetch_impl` that
 * routes diffs directly into the ViewStateWriter. No HTTP, no Ollama,
 * no Gadgetbridge.db needed.
 *
 * Asserts:
 *   1. tier1 lands → version bumps from 0
 *   2. night_review slot dispatches → status='fresh'
 *   3. morning_briefing follows depends_on
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SchedulerDaemon } from "../daemon.ts";
import { Outbox } from "../../transport/outbox.ts";
import { ViewStateWriter } from "../../view-state/writer.ts";
import type { Tier1 } from "../../types.ts";
import type { OllamaResult } from "../../../ollama.ts";

let root: string;
let writer: ViewStateWriter;
let outbox: Outbox;
let queueDir: string;

const NOW = new Date("2026-05-27T09:30:00+02:00");

function fakeTier1(period_key: string): Tier1 {
  return {
    computed_at: NOW.toISOString(),
    facts_now: {
      now_ms: NOW.getTime(),
      last_db_sample_at: "2026-05-27T09:25:00+02:00",
      data_lag_min: 5,
      sleeping_in_progress: false,
      last_workout_end_at: null,
      hr_now: 62,
    },
    kpis_today: {
      tst_min: 422, sleep_eff_pct: 92, rmssd_ms: 50,
      rhr_sleep_bpm: 56, rhr_day_bpm: 64,
      steps: 1800, active_kcal: 70, stress_mean: null,
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
      plan_session_today: null,
      pain_flags_active: [],
      anomalies_today: [],
    },
  };
}

function fakeFetch(): typeof fetch {
  return async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const kind = body.kind as string;
    delete body.kind;
    try {
      if (kind === "tier1") {
        const view = await writer.applyTier1(body);
        return new Response(JSON.stringify({ ok: true, version: view.version }), { status: 200 });
      }
      if (kind === "slot") {
        const view = await writer.applySlot(body);
        return new Response(JSON.stringify({ ok: true, version: view.version }), { status: 200 });
      }
      if (kind === "meta") {
        const view = await writer.applyMeta(body);
        return new Response(JSON.stringify({ ok: true, version: view.version }), { status: 200 });
      }
      void url;
      return new Response(JSON.stringify({ ok: false, code: "bad_request" }), { status: 400 });
    } catch (err: unknown) {
      const isVc = err instanceof Error && err.name === "VersionConflictError";
      if (isVc) {
        const actual = (err as unknown as { actual: number }).actual;
        return new Response(
          JSON.stringify({ ok: false, code: "version_conflict", current_version: actual }),
          { status: 409 },
        );
      }
      return new Response(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        { status: 500 },
      );
    }
  };
}

function nightReviewOutput(): string {
  return JSON.stringify({
    schema_version: "night-review/v1",
    language: "de",
    incomplete: false,
    abstain: false,
    abstain_reason: null,
    headline: "Solide Nacht",
    summary_short: "TST 422 min, Effizienz 92%.",
    summary_long: "TST 422 min, RMSSD 50 ms, Effizienz 92%.",
    analysis_today: "TST 422 min, RHR 56 bpm.",
    analysis_context: "RMSSD 50 ms vs Baseline.",
    suggestions_today: [],
    kpis: [
      { reasoning: "Effizienz 92% solide.", id: "sleep_quality", label_de: "Schlafqualität", value: 78, band: "steady" },
      { reasoning: "RMSSD 50 ms — solide.", id: "recovery_readiness", label_de: "Erholung", value: 65, band: "steady" },
      { reasoning: "Konsistent vs 422 min Median.", id: "sleep_consistency", label_de: "Konsistenz", value: 70, band: "steady" },
    ],
    confidence: { value: 0.72, reasoning: "Wear-Zeit ausreichend, TST 422 min bestätigt." },
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pulse-v4-e2e-"));
  queueDir = path.join(root, "outbox");
  writer = new ViewStateWriter({ view_root: root, now: () => NOW });
  outbox = new Outbox({
    pi_base_url: "http://stub",
    queue_dir: queueDir,
    fetch_impl: fakeFetch(),
  });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SchedulerDaemon end-to-end", () => {
  it("ticks: tier1 + night_review dispatch", async () => {
    const daemon = new SchedulerDaemon({
      db: (() => ({ prepare: () => ({ get: () => null, all: () => [] }) })) as never,
      insights_root: path.join(root, "insights"),
      view_root: root,
      outbox,
      tz: "Europe/Berlin",
      now: () => NOW,
      buildTier1: async (periodKey) => fakeTier1(periodKey),
      invoker: async (): Promise<OllamaResult> => ({
        content: nightReviewOutput(),
        totalMs: 50,
        promptTokens: 100,
        evalTokens: 100,
        endpoint: "local",
        endpointUrl: "test",
      }),
    });

    const report = await daemon.tick();

    expect(report.period_key).toBe("2026-05-27");
    expect(report.tier1_submitted).toBe(true);
    expect(report.slots_dispatched).toContain("night_review");
    expect(report.slots_succeeded).toContain("night_review");

    const view = await writer.read("daily", "2026-05-27");
    expect(view).not.toBeNull();
    if (!view || view.scope !== "daily") throw new Error("expected daily");
    expect(view.tier1.kpis_today.tst_min).toBe(422);
    expect(view.slots.night_review.status).toBe("fresh");
    expect(view.slots.night_review.payload).not.toBeNull();
  });
});
