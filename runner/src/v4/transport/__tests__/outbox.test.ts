import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Outbox } from "../outbox.ts";
import type { SlotDiff } from "../../types.ts";

let queueDir: string;

beforeAll(async () => {
  queueDir = await mkdtemp(path.join(tmpdir(), "pulse-v4-outbox-"));
});

afterAll(async () => {
  await rm(queueDir, { recursive: true, force: true });
});

function diff(): SlotDiff {
  return {
    scope: "daily",
    period_key: "2026-05-27",
    slot_id: "night_review",
    expected_version: 1,
    entry: {
      slot_id: "night_review",
      status: "fresh",
      scheduled_for: "2026-05-27T07:00:00+02:00",
      ttl_ms: 22 * 3600_000,
      computed_at: "2026-05-27T07:30:00+02:00",
      computed_by: { model: "qwen3.6", slot_version: "night-review/v1", prompt_version: "p1" },
      payload: { schema_version: "night-review/v1" },
      inputs_used: null,
      error: null,
      degraded_reason: null,
      request_count: 1,
      version: 0,
    },
  };
}

describe("Outbox", () => {
  it("returns ok=true on 200", async () => {
    const outbox = new Outbox({
      pi_base_url: "http://stub",
      queue_dir: queueDir,
      fetch_impl: async () =>
        new Response(JSON.stringify({ ok: true, version: 2 }), { status: 200 }),
    });
    const result = await outbox.submit({ kind: "slot", diff: diff() });
    expect(result.ok).toBe(true);
    expect(result.current_version).toBe(2);
    expect(result.queued).toBe(false);
  });

  it("surfaces 409 CAS conflict without queueing", async () => {
    const outbox = new Outbox({
      pi_base_url: "http://stub",
      queue_dir: queueDir,
      fetch_impl: async () =>
        new Response(
          JSON.stringify({ ok: false, code: "version_conflict", current_version: 5 }),
          { status: 409 },
        ),
    });
    const result = await outbox.submit({ kind: "slot", diff: diff() });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("version_conflict");
    expect(result.current_version).toBe(5);
    expect(result.queued).toBe(false);
  });

  it("queues on 5xx for replay", async () => {
    const outbox = new Outbox({
      pi_base_url: "http://stub",
      queue_dir: queueDir,
      fetch_impl: async () => new Response("oops", { status: 503 }),
    });
    const result = await outbox.submit({ kind: "slot", diff: diff() });
    expect(result.ok).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.queue_path).not.toBeNull();
  });

  it("queues on network error", async () => {
    const outbox = new Outbox({
      pi_base_url: "http://stub",
      queue_dir: queueDir,
      fetch_impl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await outbox.submit({ kind: "slot", diff: diff() });
    expect(result.ok).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("drains queue and drops on success", async () => {
    // Queue dir now has at least one persisted item from the 5xx test above.
    const before = await readdir(queueDir);
    expect(before.length).toBeGreaterThan(0);
    const outbox = new Outbox({
      pi_base_url: "http://stub",
      queue_dir: queueDir,
      fetch_impl: async () =>
        new Response(JSON.stringify({ ok: true, version: 99 }), { status: 200 }),
    });
    const { replayed } = await outbox.drainQueue();
    expect(replayed).toBeGreaterThan(0);
    const after = await readdir(queueDir);
    expect(after.length).toBe(0);
  });
});
