/**
 * In-process queue priority + FIFO semantics.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  InProcessQueue,
  pushQueue,
  popQueue,
  _resetQueueForTests,
} from "../../src/jobs/queue.ts";
import { JobPriority } from "../../src/jobs/types.ts";

beforeEach(() => {
  _resetQueueForTests();
});

describe("InProcessQueue priority", () => {
  it("higher priority pops before lower", () => {
    const q = new InProcessQueue();
    const base = 1_000_000;
    q.push({
      cluster: "sleep",
      key: "2026-05-15",
      scope: "daily",
      priority: JobPriority.Backfill,
      requested_at_ms: base,
      reason: "x",
    });
    q.push({
      cluster: "sleep",
      key: "2026-05-15",
      scope: "daily",
      priority: JobPriority.UserRequested,
      requested_at_ms: base + 1,
      reason: "x",
    });
    q.push({
      cluster: "sleep",
      key: "2026-05-15",
      scope: "daily",
      priority: JobPriority.BackgroundRecompute,
      requested_at_ms: base + 2,
      reason: "x",
    });
    q.push({
      cluster: "sleep",
      key: "2026-05-15",
      scope: "daily",
      priority: JobPriority.AutoProcess,
      requested_at_ms: base + 3,
      reason: "x",
    });
    expect(q.pop()?.priority).toBe(JobPriority.UserRequested);
    expect(q.pop()?.priority).toBe(JobPriority.AutoProcess);
    expect(q.pop()?.priority).toBe(JobPriority.BackgroundRecompute);
    expect(q.pop()?.priority).toBe(JobPriority.Backfill);
    expect(q.pop()).toBeNull();
  });

  it("FIFO within a priority tier", () => {
    const q = new InProcessQueue();
    const t0 = 2_000_000;
    for (let i = 0; i < 5; i++) {
      q.push({
        cluster: "activity",
        key: `2026-05-${10 + i}`,
        scope: "daily",
        priority: JobPriority.AutoProcess,
        requested_at_ms: t0 + i,
        reason: "x",
      });
    }
    for (let i = 0; i < 5; i++) {
      expect(q.pop()?.key).toBe(`2026-05-${10 + i}`);
    }
  });
});

describe("module-level pushQueue/popQueue", () => {
  it("preserves the same heap across helper calls", () => {
    pushQueue({
      cluster: "x",
      key: "k1",
      scope: "daily",
      priority: JobPriority.Backfill,
      requested_at_ms: 1,
      reason: "a",
    });
    pushQueue({
      cluster: "x",
      key: "k2",
      scope: "daily",
      priority: JobPriority.UserRequested,
      requested_at_ms: 2,
      reason: "b",
    });
    expect(popQueue()?.key).toBe("k2");
    expect(popQueue()?.key).toBe("k1");
  });
});
