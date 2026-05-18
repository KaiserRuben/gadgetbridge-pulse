/**
 * JobCell semantics — claim atomicity, release transitions, markStale
 * preservation, sweep with retry cap.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { claim, markStale, read, release, sweepStaleLeases } from "../../src/jobs/cell.ts";
import { MAX_RETRIES } from "../../src/jobs/types.ts";
import { makeTestDb, type TestDbHandle } from "./_helpers.ts";

let h: TestDbHandle;
const CLUSTER = "sleep";
const KEY = "2026-05-15";

function seedPending(): void {
  h.db.prepare(
    `INSERT INTO PULSE_INSIGHT
       (period_key, scope, cluster, version, status, payload_json, source, updated_at,
        started_at, leased_at, error_text, retries)
     VALUES (?, 'daily', ?, 1, 'pending', '{}', 'test', ?, NULL, NULL, NULL, 0)`,
  ).run(KEY, CLUSTER, new Date().toISOString());
}

beforeEach(() => {
  h = makeTestDb();
});

afterEach(() => {
  h.close();
});

describe("cell.claim", () => {
  it("two concurrent claimers — only one wins", () => {
    seedPending();
    const a = claim(CLUSTER, KEY, 60_000);
    const b = claim(CLUSTER, KEY, 60_000);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(a?.leased_at).not.toBeNull();
    expect(a?.state).toBe("pending");
  });

  it("returns null when the row is not pending", () => {
    h.db.prepare(
      `INSERT INTO PULSE_INSIGHT
         (period_key, scope, cluster, version, status, payload_json, source, updated_at,
          started_at, leased_at, error_text, retries)
       VALUES (?, 'daily', ?, 1, 'complete', '{}', 'test', ?, ?, NULL, NULL, 0)`,
    ).run(KEY, CLUSTER, new Date().toISOString(), new Date().toISOString());
    const r = claim(CLUSTER, KEY, 60_000);
    expect(r).toBeNull();
  });

  it("stamps started_at on first claim and preserves it on later claims", () => {
    seedPending();
    const first = claim(CLUSTER, KEY, 60_000);
    expect(first?.started_at).not.toBeNull();
    // Release then back to pending and re-claim — started_at must persist.
    release(CLUSTER, KEY, { payload: { x: 1 } });
    // markStale to push back to pending.
    markStale(CLUSTER, KEY, "rerun");
    const second = claim(CLUSTER, KEY, 60_000);
    expect(second?.started_at).toBe(first?.started_at);
  });
});

describe("cell.release", () => {
  it("sets status=complete and clears leased_at on success", () => {
    seedPending();
    claim(CLUSTER, KEY, 60_000);
    release(CLUSTER, KEY, { payload: { headline: "ok" } });
    const r = read(CLUSTER, KEY);
    expect(r?.state).toBe("complete");
    expect(r?.leased_at).toBeNull();
    expect(r?.payload).toEqual({ headline: "ok" });
  });

  it("sets status=partial when an error is reported", () => {
    seedPending();
    claim(CLUSTER, KEY, 60_000);
    release(CLUSTER, KEY, { payload: { partial: true } }, "vlm_timeout");
    const r = read(CLUSTER, KEY);
    expect(r?.state).toBe("partial");
    expect(r?.error_text).toBe("vlm_timeout");
  });
});

describe("cell.markStale", () => {
  it("preserves payload_json while flipping back to pending", () => {
    seedPending();
    claim(CLUSTER, KEY, 60_000);
    release(CLUSTER, KEY, { payload: { v: 42 } });
    markStale(CLUSTER, KEY, "event:day_end");
    const r = read(CLUSTER, KEY);
    expect(r?.state).toBe("pending");
    expect(r?.leased_at).toBeNull();
    // markStale uses INSERT ... ON CONFLICT which keeps payload_json on the
    // UPDATE branch — verify the prior value survives.
    expect(r?.payload).toEqual({ v: 42 });
    expect(r?.error_text).toBe("event:day_end");
  });
});

describe("cell.sweepStaleLeases", () => {
  it("clears expired leases and increments retries", async () => {
    seedPending();
    const r1 = claim(CLUSTER, KEY, 60_000);
    expect(r1).not.toBeNull();
    // Backdate the lease by raw SQL — the better-sqlite3 driver can't fake
    // time, so we shove leased_at three hours into the past.
    h.db.prepare(
      `UPDATE PULSE_INSIGHT
          SET leased_at = datetime('now', '-3 hours')
        WHERE cluster = ? AND period_key = ?`,
    ).run(CLUSTER, KEY);
    const swept = sweepStaleLeases(60_000);
    expect(swept).toBe(1);
    const after = read(CLUSTER, KEY);
    expect(after?.leased_at).toBeNull();
    expect(after?.retries).toBe(1);
  });

  it("flips rows past MAX_RETRIES to status=partial", () => {
    seedPending();
    // Manually crank retries past the cap. Sweep doesn't itself bump retries
    // when there's no current lease — but the second pass picks it up by the
    // retries > MAX_RETRIES predicate.
    h.db.prepare(
      `UPDATE PULSE_INSIGHT SET retries = ? WHERE cluster = ? AND period_key = ?`,
    ).run(MAX_RETRIES + 1, CLUSTER, KEY);
    const swept = sweepStaleLeases(60_000);
    expect(swept).toBeGreaterThanOrEqual(1);
    const r = read(CLUSTER, KEY);
    expect(r?.state).toBe("partial");
    expect(r?.error_text).toBe("max_retries_exceeded");
  });
});
