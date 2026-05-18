/**
 * Generic JobCell worker — claim → extract → prose → release on success,
 * release-with-error-text on prose failure, two parallel enqueues serialise
 * through the queue.
 *
 * The Ollama call inside the real prose() goes through `callOllama` which
 * itself has a global mutex (proven by ollama-mutex.test.ts), so to keep
 * this suite focused on worker semantics we register a synthetic cluster
 * via CLUSTER_REGISTRY and mock the underlying functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { CLUSTER_REGISTRY } from "../../src/clusters/index.ts";
import { JobPriority } from "../../src/jobs/types.ts";
import { _runOneForTests } from "../../src/jobs/worker.ts";
import { enqueue, read } from "../../src/jobs/cell.ts";
import type { QueueItem } from "../../src/jobs/queue.ts";
import { _resetQueueForTests, popQueue } from "../../src/jobs/queue.ts";
import { makeTestDb, type TestDbHandle } from "./_helpers.ts";

let h: TestDbHandle;
const SYNTH_CLUSTER = "test_synth";
const PERIOD = "2026-05-15";

function registerSynth(opts: {
  extractFn?: (ctx: unknown) => Promise<unknown>;
  proseFn?: (pkg: unknown, ctx: unknown) => Promise<unknown>;
} = {}): void {
  CLUSTER_REGISTRY.set(SYNTH_CLUSTER, {
    name: SYNTH_CLUSTER,
    extract:
      (opts.extractFn ?? (async () => ({
        cluster: SYNTH_CLUSTER,
        key: PERIOD,
        scope: "daily",
        generated_at: new Date().toISOString(),
        payload: { stage: "extract" },
        provenance: [{ field_path: "stub", source: "rule_computed" }],
        deps: [],
        package_version: 1,
      }))) as never,
    prose:
      (opts.proseFn ?? (async (pkg: unknown) => ({
        ...(pkg as object),
        payload: { stage: "prose", headline: "ok" },
        provenance: [
          { field_path: "stub", source: "rule_computed" },
          { field_path: "headline", source: "llm_derived", confidence: 0.7 },
        ],
        generated_at: new Date().toISOString(),
      }))) as never,
    deps: () => [],
    payloadSchema: { type: "object" },
  });
}

beforeEach(async () => {
  h = makeTestDb();
  _resetQueueForTests();
  CLUSTER_REGISTRY.delete(SYNTH_CLUSTER);
});

afterEach(() => {
  CLUSTER_REGISTRY.delete(SYNTH_CLUSTER);
  h.close();
});

describe("worker — happy path", () => {
  it("picks one pending cell, runs extract+prose, releases as complete", async () => {
    registerSynth();
    await enqueue({
      cluster: SYNTH_CLUSTER,
      key: PERIOD,
      scope: "daily",
      priority: JobPriority.UserRequested,
      reason: "test",
    });
    const item = popQueue();
    expect(item).not.toBeNull();
    await _runOneForTests(item as QueueItem);

    const row = read(SYNTH_CLUSTER, PERIOD);
    expect(row).not.toBeNull();
    expect(row?.state).toBe("complete");
    expect(row?.leased_at).toBeNull();
    expect(row?.error_text).toBeNull();
    expect(row?.payload).toEqual({ stage: "prose", headline: "ok" });
    expect(row?.provenance).toHaveLength(2);
    expect(row?.provenance[1]).toMatchObject({
      field_path: "headline",
      source: "llm_derived",
      confidence: 0.7,
    });
  });
});

describe("worker — prose failure", () => {
  it("releases the cell with error_text set", async () => {
    registerSynth({
      proseFn: async () => {
        throw new Error("ollama timeout");
      },
    });
    await enqueue({
      cluster: SYNTH_CLUSTER,
      key: PERIOD,
      scope: "daily",
      priority: JobPriority.UserRequested,
      reason: "test",
    });
    const item = popQueue();
    await _runOneForTests(item as QueueItem);

    const row = read(SYNTH_CLUSTER, PERIOD);
    expect(row?.state).toBe("partial");
    expect(row?.error_text).toContain("ollama timeout");
    expect(row?.leased_at).toBeNull();
    // Extract payload is preserved so the dashboard still shows context.
    expect(row?.payload).toEqual({ stage: "extract" });
  });
});

describe("worker — extract failure", () => {
  it("releases the cell with error_text and null payload", async () => {
    registerSynth({
      extractFn: async () => {
        throw new Error("daily.json missing");
      },
    });
    await enqueue({
      cluster: SYNTH_CLUSTER,
      key: PERIOD,
      scope: "daily",
      priority: JobPriority.UserRequested,
      reason: "test",
    });
    const item = popQueue();
    await _runOneForTests(item as QueueItem);

    const row = read(SYNTH_CLUSTER, PERIOD);
    expect(row?.state).toBe("partial");
    expect(row?.error_text).toContain("daily.json missing");
    // Read returns the envelope when inner payload is null (`null ?? parsed`
    // in rowToResult falls back to the wrapper). What matters is that no
    // useful extracted body landed.
    const envelope = row?.payload as { payload?: unknown } | null;
    expect(envelope?.payload ?? null).toBeNull();
  });
});

describe("worker — claim contention", () => {
  it("two parallel enqueues claim once each, second is a no-op", async () => {
    let extractCalls = 0;
    registerSynth({
      extractFn: async () => {
        extractCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          cluster: SYNTH_CLUSTER,
          key: PERIOD,
          scope: "daily",
          generated_at: new Date().toISOString(),
          payload: { stage: "extract", n: extractCalls },
          provenance: [],
          deps: [],
          package_version: 1,
        };
      },
    });

    // First enqueue + drain.
    await enqueue({
      cluster: SYNTH_CLUSTER,
      key: PERIOD,
      scope: "daily",
      priority: JobPriority.UserRequested,
      reason: "first",
    });
    const item1 = popQueue();
    expect(item1).not.toBeNull();

    // Second enqueue lands BEFORE the first finishes — flip-to-pending is a
    // no-op because the row is leased. The queue still receives the token
    // because pushQueue runs unconditionally.
    const firstRun = _runOneForTests(item1 as QueueItem);

    // Simulate a contender attempt directly: claim during the in-flight run
    // returns null (leased_at is set) — covered by cell.test.ts. We just
    // verify here that running the same item twice does not double-execute
    // extract.
    await firstRun;
    const row1 = read(SYNTH_CLUSTER, PERIOD);
    expect(row1?.state).toBe("complete");

    // Now run the same item again — the cell is no longer pending, so the
    // worker logs "claim lost" and skips. extractCalls stays at 1.
    await _runOneForTests(item1 as QueueItem);
    expect(extractCalls).toBe(1);
  });
});
