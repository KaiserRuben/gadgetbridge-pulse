/**
 * JobCell — HTTP shim over Pi's /api/jobs/cell/[op].
 *
 * Single-writer architecture: only the Pi mutates pulse.db. Every atomic
 * cell op (claim, release, markStale, enqueue, sweep) routes through HTTP
 * to the Pi, which runs the SQL inside one process and returns the result.
 * Mac never holds a writable handle to pulse.db.
 *
 * Behaviour parity with the previous local-SQLite implementation:
 *   - claim() returns the claimed cell when ours, null otherwise.
 *   - release() / markStale() / enqueue() are fire-and-forget on the wire,
 *     surfaced as void to keep callers stable.
 *   - sweepStaleLeases() returns the count for the dispatcher log line.
 *
 * Pi unreachable: each helper logs a warning and returns null / false. The
 * dispatcher tick treats a null claim like "another worker has it" and
 * proceeds — when the Pi comes back the next tick picks up where we left
 * off.
 */

import { log } from "../logger.ts";
import {
  piCellClaim,
  piCellEnqueuePending,
  piCellMarkStale,
  piCellRead,
  piCellRelease,
  piCellSweep,
  type CellResult,
  type CellScope,
  type CellState,
  type CellProvenanceTag,
} from "../ingest/client.ts";
import { getRedis } from "./redis.ts";
import { pushQueue, type QueueItem } from "./queue.ts";
import {
  type ProvenanceTag,
  type JobPriority,
  MAX_RETRIES,
} from "./types.ts";

export type Scope = CellScope;
export type InsightStatus = "pending" | "live" | "partial" | "complete";
export type { CellState };

export interface CellKey {
  cluster: string;
  key: string;
  scope?: Scope;
}

export type CellReadResult = CellResult;

export async function read(
  cluster: string,
  key: string,
  scope: Scope = "daily",
): Promise<CellReadResult | null> {
  return piCellRead(cluster, key, scope);
}

export async function claim(
  cluster: string,
  key: string,
  _leaseMs: number,
  scope: Scope = "daily",
): Promise<CellReadResult | null> {
  return piCellClaim(cluster, key, scope);
}

export interface ReleasePayload {
  payload: unknown;
  provenance?: ProvenanceTag[];
}

export async function release(
  cluster: string,
  key: string,
  value: ReleasePayload,
  error: string | null = null,
  scope: Scope = "daily",
): Promise<void> {
  await piCellRelease(
    cluster,
    key,
    value.payload,
    (value.provenance ?? []) as unknown as CellProvenanceTag[],
    error,
    scope,
  );
}

export async function markStale(
  cluster: string,
  key: string,
  reason: string,
  scope: Scope = "daily",
): Promise<void> {
  await piCellMarkStale(cluster, key, reason, scope);
}

/**
 * Sweep stale leases on the Pi. Returns total rows touched so the dispatcher
 * can emit its periodic "swept N stale leases" log line.
 */
export async function sweepStaleLeases(ttlMs: number): Promise<number> {
  return piCellSweep(ttlMs, MAX_RETRIES);
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

export interface EnqueueOpts {
  cluster: string;
  key: string;
  scope?: Scope;
  priority: JobPriority;
  reason: string;
}

/**
 * Enqueue a cluster/key onto the dispatch queue and ensure the Pi cell row
 * exists in `pending` state. The cell upsert goes through HTTP so the
 * dashboard immediately sees a `reprocessing` pill; the queue side (Redis or
 * in-process heap) is mac-local because the worker that picks the item up
 * is on this host.
 */
export async function enqueue(opts: EnqueueOpts): Promise<void> {
  const scope: Scope = opts.scope ?? "daily";
  await piCellEnqueuePending(opts.cluster, opts.key, scope);

  const item: QueueItem = {
    cluster: opts.cluster,
    key: opts.key,
    scope,
    priority: opts.priority,
    requested_at_ms: Date.now(),
    reason: opts.reason,
  };

  const redis = getRedis();
  if (redis) {
    try {
      // Score: priority pushed into MSB so higher wins under ZRANGEBYSCORE
      // DESC; ts encoded in LSB for FIFO within a tier. Members serialise to
      // JSON so ZPOPMIN-side consumers can reconstruct the QueueItem.
      const score = -(opts.priority * 1e13) + item.requested_at_ms;
      await redis.zadd("pulse:jobs:pending", score, JSON.stringify(item));
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("jobs", `redis enqueue failed, fallback in-process: ${msg}`);
    }
  }
  pushQueue(item);
}
