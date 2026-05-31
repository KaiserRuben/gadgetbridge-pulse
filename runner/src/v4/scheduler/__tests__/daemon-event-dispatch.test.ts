/**
 * Event-slot dispatch path through the daemon.
 *
 * Asserts the four hooks promised by Phase 2 event-slot wiring:
 *   1. sleep_complete is a no-op for event slots (no event-list submit).
 *   2. workout_complete with valid payload → post_workout dispatched once.
 *   3. Existing fresh post_workout entry → workout_complete skips dispatch.
 *   4. CAS conflict on event-slot submit → not retried, no infinite loop.
 *   5. tick() picks up a `scheduled` event entry whose scheduled_for ≤ now.
 *
 * Pattern mirrors daemon.test.ts: a `fakeFetch()` routes diffs into a real
 * ViewStateWriter. Tier1 build is stubbed; the LLM invoker returns a
 * schema-conformant post-workout payload so the diff lands as `fresh`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SchedulerDaemon } from "../daemon.ts";
import { Outbox } from "../../transport/outbox.ts";
import { ViewStateWriter } from "../../view-state/writer.ts";
import type { Tier1, SlotDiff, PostWorkoutSlotEntry } from "../../types.ts";
import type { OllamaResult } from "../../../ollama.ts";

let root: string;
let writer: ViewStateWriter;
let queueDir: string;
let submits: Array<{ kind: string; diff: unknown }>;

const NOW = new Date("2026-05-27T18:50:00+02:00");
const PERIOD_KEY = "2026-05-27";
const WORKOUT_START_ISO = "2026-05-27T18:00:00+02:00";
const WORKOUT_END_ISO = "2026-05-27T18:45:00+02:00";

function fakeTier1(): Tier1 {
  return {
    computed_at: NOW.toISOString(),
    facts_now: {
      now_ms: NOW.getTime(),
      last_db_sample_at: NOW.toISOString(),
      data_lag_min: 1,
      sleeping_in_progress: false,
      last_workout_end_at: WORKOUT_END_ISO,
      hr_now: 88,
    },
    kpis_today: {
      tst_min: 422,
      sleep_eff_pct: 92,
      rmssd_ms: 50,
      rhr_sleep_bpm: 56,
      rhr_day_bpm: 64,
      steps: 9000,
      active_kcal: 540,
      stress_mean: 32,
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
  };
}

function postWorkoutOutput(): string {
  return JSON.stringify({
    schema_version: "post-workout/v1",
    language: "de",
    incomplete: false,
    abstain: false,
    abstain_reason: null,
    headline: "Solide Einheit",
    summary_short: "45 min moderater Lauf.",
    summary_long: "45 min moderater Lauf, 540 kcal aktiv.",
    load_assessment: {
      reasoning: "45 min entspricht typischer Wochen-Einheit von ungefähr 45 min.",
      level: "moderate",
      vs_recent: "vergleichbar zur Wochenroutine",
    },
    recovery_window: {
      reasoning: "Moderate Einheit erfordert eine kurze Erholungsphase nach der Einheit.",
      hours_estimated: 18,
      guidance: "Heute leichtes Stretching, morgen Easy-Run.",
    },
    fueling_hint: null,
    next_session_hint: null,
    kpis: [
      {
        reasoning: "Last entsprach moderater Standardwoche im Verlauf.",
        id: "workout_load_assessment",
        label_de: "Belastung",
        value: 55,
        band: "steady",
      },
    ],
    confidence: {
      value: 0.7,
      reasoning: "Workout-Daten vollständig, Vergleich zur Wochenroutine stabil.",
    },
  });
}

function fakeFetch(): typeof fetch {
  return async (_url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const kind = body.kind as string;
    delete body.kind;
    submits.push({ kind, diff: body });
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

function buildOutbox(): Outbox {
  return new Outbox({
    pi_base_url: "http://stub",
    queue_dir: queueDir,
    fetch_impl: fakeFetch(),
  });
}

function buildDaemon(outbox: Outbox): SchedulerDaemon {
  return new SchedulerDaemon({
    db: { prepare: () => ({ get: () => null, all: () => [] }) } as never,
    insights_root: path.join(root, "insights"),
    view_root: root,
    outbox,
    tz: "Europe/Berlin",
    now: () => NOW,
    buildTier1: async () => fakeTier1(),
    invoker: async (): Promise<OllamaResult> => ({
      content: postWorkoutOutput(),
      totalMs: 10,
      promptTokens: 0,
      evalTokens: 0,
      endpoint: "local",
      endpointUrl: "test",
    }),
  });
}

async function seedInitialView(): Promise<void> {
  const initial = await writer.readOrInit("daily", PERIOD_KEY);
  await writer.applyTier1({
    scope: "daily",
    period_key: PERIOD_KEY,
    tier1: fakeTier1(),
    expected_version: initial.version,
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pulse-v4-event-disp-"));
  queueDir = path.join(root, "outbox");
  writer = new ViewStateWriter({ view_root: root, now: () => NOW });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  submits = [];
  writer = new ViewStateWriter({ view_root: root, now: () => NOW });
  await seedInitialView();
});

describe("SchedulerDaemon event-slot dispatch", () => {
  it("ignores sleep_complete for event slots (no event-slot submit)", async () => {
    const outbox = buildOutbox();
    const daemon = buildDaemon(outbox);

    await daemon.applyBumpEvent("sleep_complete", "daily", PERIOD_KEY, {
      bedtime_iso: "2026-05-27T00:30:00+02:00",
      wake_iso: "2026-05-27T07:30:00+02:00",
    });

    const eventSubmits = submits.filter(
      (s) =>
        s.kind === "slot" &&
        ((s.diff as SlotDiff).slot_id === "post_workout" ||
          (s.diff as SlotDiff).slot_id === "anomaly_explain"),
    );
    expect(eventSubmits).toHaveLength(0);
  });

  it("dispatches post_workout on workout_complete with valid payload", async () => {
    const outbox = buildOutbox();
    const daemon = buildDaemon(outbox);

    const touched = await daemon.applyBumpEvent("workout_complete", "daily", PERIOD_KEY, {
      start_iso: WORKOUT_START_ISO,
      end_iso: WORKOUT_END_ISO,
      kind: 1,
      duration_min: 45,
    });

    expect(touched).toContain("post_workout");
    const pwSubmits = submits.filter(
      (s) => s.kind === "slot" && (s.diff as SlotDiff).slot_id === "post_workout",
    );
    expect(pwSubmits).toHaveLength(1);
    expect((pwSubmits[0].diff as SlotDiff).event_id).toBe(WORKOUT_START_ISO);

    const view = await writer.read("daily", PERIOD_KEY);
    expect(view?.events.post_workout).toHaveLength(1);
    const stored = view?.events.post_workout[0];
    expect(stored?.event_id).toBe(WORKOUT_START_ISO);
    expect(stored?.status).toBe("fresh");
  });

  it("skips dispatch when an existing post_workout entry is already fresh", async () => {
    const view = await writer.read("daily", PERIOD_KEY);
    if (!view) throw new Error("seed view missing");
    const freshEntry: PostWorkoutSlotEntry = {
      slot_id: "post_workout",
      status: "fresh",
      scheduled_for: WORKOUT_END_ISO,
      ttl_ms: 12 * 3600_000,
      computed_at: NOW.toISOString(),
      computed_by: {
        model: "gpt-oss:20b",
        slot_version: "post-workout/v1",
        prompt_version: "p1-post-workout",
      },
      payload: null,
      inputs_used: null,
      error: null,
      degraded_reason: null,
      request_count: 1,
      version: 0,
      event_id: WORKOUT_START_ISO,
      workout_ref: {
        ts_start_iso: WORKOUT_START_ISO,
        ts_end_iso: WORKOUT_END_ISO,
        kind: 1,
      },
    };
    await writer.applySlot({
      scope: "daily",
      period_key: PERIOD_KEY,
      slot_id: "post_workout",
      event_id: WORKOUT_START_ISO,
      entry: freshEntry,
      expected_version: view.version,
    });

    const outbox = buildOutbox();
    const daemon = buildDaemon(outbox);

    submits = [];
    const touched = await daemon.applyBumpEvent("workout_complete", "daily", PERIOD_KEY, {
      start_iso: WORKOUT_START_ISO,
      end_iso: WORKOUT_END_ISO,
      kind: 1,
      duration_min: 45,
    });

    expect(touched).not.toContain("post_workout");
    const pwSubmits = submits.filter(
      (s) => s.kind === "slot" && (s.diff as SlotDiff).slot_id === "post_workout",
    );
    expect(pwSubmits).toHaveLength(0);
  });

  it("CAS conflict on event-slot submit is logged once (no retry loop)", async () => {
    let intercepted = 0;
    const conflictingFetch: typeof fetch = async (url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const kind = body.kind as string;
      if (kind === "slot" && body.slot_id === "post_workout") {
        intercepted++;
        return new Response(
          JSON.stringify({ ok: false, code: "version_conflict", current_version: 99 }),
          { status: 409 },
        );
      }
      delete body.kind;
      submits.push({ kind, diff: body });
      if (kind === "tier1") {
        const view = await writer.applyTier1(body);
        return new Response(JSON.stringify({ ok: true, version: view.version }), { status: 200 });
      }
      if (kind === "slot") {
        const view = await writer.applySlot(body);
        return new Response(JSON.stringify({ ok: true, version: view.version }), { status: 200 });
      }
      void url;
      return new Response(JSON.stringify({ ok: false }), { status: 400 });
    };

    const outbox = new Outbox({
      pi_base_url: "http://stub",
      queue_dir: queueDir,
      fetch_impl: conflictingFetch,
    });
    const daemon = buildDaemon(outbox);

    await daemon.applyBumpEvent("workout_complete", "daily", PERIOD_KEY, {
      start_iso: WORKOUT_START_ISO,
      end_iso: WORKOUT_END_ISO,
      kind: 1,
      duration_min: 45,
    });

    expect(intercepted).toBe(1);
  });

  it("tick() picks up scheduled event entries past their scheduled_for", async () => {
    const view = await writer.read("daily", PERIOD_KEY);
    if (!view) throw new Error("seed view missing");
    const scheduledEntry: PostWorkoutSlotEntry = {
      slot_id: "post_workout",
      status: "scheduled",
      scheduled_for: new Date(NOW.getTime() - 60_000).toISOString(),
      ttl_ms: 12 * 3600_000,
      computed_at: null,
      computed_by: null,
      payload: null,
      inputs_used: null,
      error: null,
      degraded_reason: null,
      request_count: 0,
      version: 0,
      event_id: WORKOUT_START_ISO,
      workout_ref: {
        ts_start_iso: WORKOUT_START_ISO,
        ts_end_iso: WORKOUT_END_ISO,
        kind: 1,
      },
    };
    await writer.applySlot({
      scope: "daily",
      period_key: PERIOD_KEY,
      slot_id: "post_workout",
      event_id: WORKOUT_START_ISO,
      entry: scheduledEntry,
      expected_version: view.version,
    });

    const outbox = buildOutbox();
    const daemon = buildDaemon(outbox);
    submits = [];
    const report = await daemon.tick();

    expect(report.event_slots_dispatched).toContain(`post_workout:${WORKOUT_START_ISO}`);
    expect(report.event_slots_succeeded).toContain(`post_workout:${WORKOUT_START_ISO}`);
    const after = await writer.read("daily", PERIOD_KEY);
    expect(after?.events.post_workout[0].status).toBe("fresh");
  });
});
