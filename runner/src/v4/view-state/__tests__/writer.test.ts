import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ViewStateWriter, VersionConflictError } from "../writer.ts";
import type { SlotDiff, Tier1Diff } from "../../types.ts";

describe("ViewStateWriter", () => {
  let root: string;
  let writer: ViewStateWriter;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pulse-v4-test-"));
    writer = new ViewStateWriter({ view_root: root, now: () => new Date("2026-05-27T08:00:00Z") });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds initial daily view on first read", async () => {
    const view = await writer.readOrInit("daily", "2026-05-27");
    expect(view.scope).toBe("daily");
    expect(view.period_key).toBe("2026-05-27");
    expect(view.version).toBe(0);
    if (view.scope !== "daily") throw new Error("expected daily");
    expect(view.slots.morning_briefing.status).toBe("scheduled");
    expect(view.slots.morning_briefing.scheduled_for).toMatch(/^2026-05-27T/);
  });

  it("applies tier1 diff with CAS", async () => {
    const initial = await writer.readOrInit("daily", "2026-05-27");
    const diff: Tier1Diff = {
      scope: "daily",
      period_key: "2026-05-27",
      expected_version: initial.version,
      tier1: {
        ...initial.tier1,
        computed_at: "2026-05-27T08:01:00Z",
        kpis_today: { ...initial.tier1.kpis_today, steps: 1234 },
      },
    };
    const next = await writer.applyTier1(diff);
    expect(next.version).toBe(1);
    expect(next.tier1.kpis_today.steps).toBe(1234);
  });

  it("rejects stale expected_version", async () => {
    const initial = await writer.readOrInit("daily", "2026-05-27");
    // Apply once with version 0 → file written at version 1
    const afterFirst = await writer.applyTier1({
      scope: "daily",
      period_key: "2026-05-27",
      expected_version: 0,
      tier1: initial.tier1,
    });
    expect(afterFirst.version).toBe(1);
    // Re-try with stale expected_version=0 → CAS conflict against current version=1
    await expect(
      writer.applyTier1({
        scope: "daily",
        period_key: "2026-05-27",
        expected_version: 0,
        tier1: afterFirst.tier1,
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("appends a post_workout event slot entry", async () => {
    const initial = await writer.readOrInit("daily", "2026-05-27");
    const diff: SlotDiff = {
      scope: "daily",
      period_key: "2026-05-27",
      slot_id: "post_workout",
      event_id: "2026-05-27T16:00:00Z",
      expected_version: initial.version,
      entry: {
        slot_id: "post_workout",
        status: "fresh",
        scheduled_for: "2026-05-27T16:05:00Z",
        ttl_ms: 12 * 60 * 60 * 1000,
        computed_at: "2026-05-27T16:06:00Z",
        computed_by: { model: "qwen3.6:latest", slot_version: "post-workout/v1", prompt_version: "p1" },
        payload: { schema_version: "post-workout/v1", note: "test" },
        inputs_used: null,
        error: null,
        degraded_reason: null,
        request_count: 1,
        version: 0,
      },
    };
    const next = await writer.applySlot(diff);
    expect(next.events.post_workout).toHaveLength(1);
    expect(next.events.post_workout[0].event_id).toBe("2026-05-27T16:00:00Z");
  });
});
