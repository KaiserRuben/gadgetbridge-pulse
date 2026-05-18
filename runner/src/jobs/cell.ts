/**
 * JobCell — claim/release/markStale/sweep over PULSE_INSIGHT rows.
 *
 * Each (period_key, scope, cluster) row in PULSE_INSIGHT acts as both the
 * derived-data cache AND its own job-queue slot. M012 adds the lease columns
 * (started_at, leased_at, error_text, retries) that make this work.
 *
 * Concurrency: claim() uses an atomic UPDATE … WHERE status='pending' AND
 * leased_at IS NULL — two concurrent callers race, the loser's `changes`
 * comes back 0 and the call returns null.
 *
 * Cross-host writes: in the production topology (Mac runner → Pi dashboard)
 * the runner's pulse.db and the Pi's pulse.db are separate files. The
 * dashboard reads from Pi's, so every state-changing op here fires a
 * best-effort `pushInsight` to Pi after the local SQLite write. The local
 * write stays the source of truth for atomicity (claim's UPDATE … WHERE
 * needs SQLite); Pi sync is async and resilient via the ingest outbox.
 */

import type Database from "better-sqlite3";

import { getWritableDb } from "../db-writable.ts";
import { log } from "../logger.ts";
import { getRedis } from "./redis.ts";
import { pushQueue, type QueueItem } from "./queue.ts";
import {
  type ProvenanceTag,
  type JobPriority,
  MAX_RETRIES,
} from "./types.ts";

/**
 * Lazy import of pushInsight so dashboard routes that pull `enqueue` from
 * this module don't transitively load `ingest/outbox.ts` → `better-sqlite3`
 * during Next.js compile. The Pi-sync calls happen at runtime only.
 */
interface PushInsightLazyInput {
  periodKey: string;
  scope?: "daily" | "weekly";
  cluster: string;
  status: "pending" | "live" | "partial" | "complete";
  payload: unknown;
  source?: string;
  startedAt?: string | null;
  leasedAt?: string | null;
  errorText?: string | null;
  retries?: number | null;
}

async function pushInsightLazy(input: PushInsightLazyInput): Promise<unknown> {
  const { pushInsight } = await import("../ingest/client.ts");
  return pushInsight(input);
}

export type Scope = "daily" | "weekly";
export type InsightStatus = "pending" | "live" | "partial" | "complete";
export type CellState = InsightStatus | "empty";

export interface CellKey {
  cluster: string;
  key: string;
  scope?: Scope;
}

export interface CellReadResult {
  cluster: string;
  key: string;
  scope: Scope;
  state: CellState;
  payload: unknown;
  provenance: ProvenanceTag[];
  started_at: string | null;
  leased_at: string | null;
  error_text: string | null;
  retries: number;
  updated_at: string;
}

interface RawInsightRow {
  period_key: string;
  scope: Scope;
  cluster: string;
  status: InsightStatus;
  payload_json: string;
  source: string;
  updated_at: string;
  started_at: string | null;
  leased_at: string | null;
  error_text: string | null;
  retries: number;
}

// ── DB resolution ────────────────────────────────────────────────────────────
//
// Default to the runner's writable handle. Tests override via setCellDb().

let _dbOverride: Database.Database | null = null;

export function setCellDb(db: Database.Database | null): void {
  _dbOverride = db;
}

function getDb(): Database.Database {
  if (_dbOverride) return _dbOverride;
  return getWritableDb();
}

// ── Read helpers ─────────────────────────────────────────────────────────────

function rowToResult(row: RawInsightRow): CellReadResult {
  let parsedPayload: unknown = null;
  let provenance: ProvenanceTag[] = [];
  try {
    const parsed = JSON.parse(row.payload_json) as Record<string, unknown> | unknown[];
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      parsedPayload = obj.payload ?? parsed;
      const prov = obj.provenance;
      if (Array.isArray(prov)) provenance = prov as ProvenanceTag[];
    } else {
      parsedPayload = parsed;
    }
  } catch {
    parsedPayload = null;
  }
  return {
    cluster: row.cluster,
    key: row.period_key,
    scope: row.scope,
    state: row.status,
    payload: parsedPayload,
    provenance,
    started_at: row.started_at,
    leased_at: row.leased_at,
    error_text: row.error_text,
    retries: row.retries,
    updated_at: row.updated_at,
  };
}

export function read(
  cluster: string,
  key: string,
  scope: Scope = "daily",
): CellReadResult | null {
  const db = getDb();
  const row = db
    .prepare<
      [string, Scope, string],
      RawInsightRow
    >(
      `SELECT period_key, scope, cluster, status, payload_json, source, updated_at,
              started_at, leased_at, error_text, retries
         FROM PULSE_INSIGHT
        WHERE period_key = ? AND scope = ? AND cluster = ?`,
    )
    .get(key, scope, cluster);
  return row ? rowToResult(row) : null;
}

// ── Claim ────────────────────────────────────────────────────────────────────

/**
 * Atomic pending→leased transition. Returns the cell state after the claim
 * landed, or null when another caller raced ahead (or the row isn't pending
 * to begin with).
 *
 * The UPDATE intentionally only matches `status = 'pending' AND leased_at
 * IS NULL` so a row already leased (or already complete) cannot be claimed
 * twice. `leaseMs` is informational here — the actual TTL is enforced by
 * sweepStaleLeases below.
 */
export function claim(
  cluster: string,
  key: string,
  _leaseMs: number,
  scope: Scope = "daily",
): CellReadResult | null {
  const db = getDb();
  const nowIso = new Date().toISOString();
  // First-attempt started_at when null; subsequent claims keep it. CASE WHEN
  // gives that without needing two statements.
  const r = db
    .prepare(
      `UPDATE PULSE_INSIGHT
          SET leased_at = ?,
              started_at = COALESCE(started_at, ?)
        WHERE period_key = ?
          AND scope = ?
          AND cluster = ?
          AND status = 'pending'
          AND leased_at IS NULL`,
    )
    .run(nowIso, nowIso, key, scope, cluster);
  if (r.changes === 0) return null;
  const result = read(cluster, key, scope);
  if (result) {
    // Mirror lease state to Pi so DerivedCell can flip to "reprocessing".
    // Re-wrap the payload to the canonical {payload, provenance} shape the
    // route handler expects on read.
    const wrapped = {
      payload: result.payload ?? null,
      provenance: result.provenance,
    };
    void pushInsightLazy({
      periodKey: key,
      scope,
      cluster,
      status: "pending",
      payload: wrapped,
      startedAt: result.started_at,
      leasedAt: result.leased_at,
      retries: result.retries,
    }).catch((err) => log.warn("jobs", `claim Pi-sync ${cluster}/${key}: ${(err as Error).message}`));
  }
  return result;
}

// ── Release ──────────────────────────────────────────────────────────────────

export interface ReleasePayload {
  payload: unknown;
  provenance?: ProvenanceTag[];
}

/**
 * Mark a cell as complete (or partial if `error` is set). Clears the lease
 * and bumps version so dashboard readers know the row turned over. The
 * payload_json stores `{ payload, provenance }` so reads in route.ts return
 * both without an extra column.
 */
export function release(
  cluster: string,
  key: string,
  value: ReleasePayload,
  error: string | null = null,
  scope: Scope = "daily",
): void {
  const db = getDb();
  const status: InsightStatus = error ? "partial" : "complete";
  const nowIso = new Date().toISOString();
  const wrapped = {
    payload: value.payload,
    provenance: value.provenance ?? [],
  };
  const bodyJson = JSON.stringify(wrapped);
  // Upsert: the dispatcher creates the pending row but a release can also
  // arrive without a prior claim (e.g. direct seed). Either way we end with
  // a complete/partial row and a cleared lease.
  db.prepare(
    `INSERT INTO PULSE_INSIGHT
        (period_key, scope, cluster, version, status, payload_json, source,
         updated_at, started_at, leased_at, error_text, retries)
       VALUES (?, ?, ?, 1, ?, ?, 'runner', ?, ?, NULL, ?, 0)
       ON CONFLICT(period_key, scope, cluster) DO UPDATE SET
         version = PULSE_INSIGHT.version + 1,
         status = excluded.status,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at,
         leased_at = NULL,
         error_text = excluded.error_text`,
  ).run(key, scope, cluster, status, bodyJson, nowIso, nowIso, error);
  // Mirror to Pi so the dashboard sees `ready_fresh`. payload is the wrapped
  // {payload, provenance} shape — route.ts:splitPayload unwraps it.
  void pushInsightLazy({
    periodKey: key,
    scope,
    cluster,
    status,
    payload: wrapped,
    leasedAt: null,
    errorText: error ?? null,
  }).catch((err) => log.warn("jobs", `release Pi-sync ${cluster}/${key}: ${(err as Error).message}`));
}

// ── Mark stale ───────────────────────────────────────────────────────────────

/**
 * Flip a cell back to pending so the next dispatcher tick reprocesses it.
 * Keeps payload_json intact — the read route surfaces it as "ready_cached"
 * (or "reprocessing" depending on lease state) until a fresh release lands.
 */
export function markStale(
  cluster: string,
  key: string,
  reason: string,
  scope: Scope = "daily",
): void {
  const db = getDb();
  const nowIso = new Date().toISOString();
  // INSERT-or-update so the very first markStale on an absent row still
  // produces a pending cell (the dispatcher will then enqueue it).
  db.prepare(
    `INSERT INTO PULSE_INSIGHT
        (period_key, scope, cluster, version, status, payload_json, source,
         updated_at, started_at, leased_at, error_text, retries)
       VALUES (?, ?, ?, 1, 'pending', '{}', 'dispatcher', ?, NULL, NULL, ?, 0)
       ON CONFLICT(period_key, scope, cluster) DO UPDATE SET
         status = 'pending',
         updated_at = excluded.updated_at,
         leased_at = NULL,
         error_text = excluded.error_text`,
  ).run(key, scope, cluster, nowIso, reason);
  // Intentional: no Pi-sync here. handleInsight's writeInsight overwrites
  // payload_json on conflict, and we don't want to wipe a prior cached
  // payload Pi-side. The next claim()/release() pair will mirror state.
  // The dashboard's foldResponse keeps the cached payload during this
  // brief window.
}

// ── Sweep stale leases ───────────────────────────────────────────────────────

/**
 * Two-pass sweep:
 *   1. Any lease older than `ttlMs` gets cleared and retries++.
 *   2. Rows whose retries exceeded MAX_RETRIES flip to status='partial'
 *      with error_text='max_retries_exceeded' so they stop cycling.
 *
 * After the local sweep, mirror each affected row to Pi so the dashboard
 * doesn't stay stuck on "reprocessing" forever — without this the Mac DB
 * had leased_at cleared but Pi DB still held the lease (cross-host gap
 * documented in cell.ts's header). Mirror is fire-and-forget; retried via
 * the ingest outbox.
 *
 * Returns the total number of rows touched across both passes — useful for
 * a "swept N stale leases" log line on the dispatcher tick.
 */
export function sweepStaleLeases(ttlMs: number): number {
  const db = getDb();

  // First collect the rows that will be touched so we can mirror them
  // after the UPDATEs land. Done in two separate selects to match the two
  // UPDATE filters, then deduped on (cluster, key, scope).
  const lapsed = db
    .prepare<[number], RawInsightRow>(
      `SELECT period_key, scope, cluster, status, payload_json, source,
              updated_at, started_at, leased_at, error_text, retries
         FROM PULSE_INSIGHT
        WHERE leased_at IS NOT NULL
          AND (strftime('%s', 'now') - strftime('%s', leased_at)) * 1000 > ?`,
    )
    .all(ttlMs);

  let total = 0;
  const sweep = db
    .prepare(
      `UPDATE PULSE_INSIGHT
          SET leased_at = NULL,
              retries = retries + 1,
              error_text = COALESCE(error_text, 'lease_expired')
        WHERE leased_at IS NOT NULL
          AND (strftime('%s', 'now') - strftime('%s', leased_at)) * 1000 > ?`,
    )
    .run(ttlMs);
  total += sweep.changes;

  const overretried = db
    .prepare<[number], RawInsightRow>(
      `SELECT period_key, scope, cluster, status, payload_json, source,
              updated_at, started_at, leased_at, error_text, retries
         FROM PULSE_INSIGHT
        WHERE status = 'pending'
          AND leased_at IS NULL
          AND retries > ?`,
    )
    .all(MAX_RETRIES);

  const cap = db
    .prepare(
      `UPDATE PULSE_INSIGHT
          SET status = 'partial',
              error_text = 'max_retries_exceeded'
        WHERE status = 'pending'
          AND leased_at IS NULL
          AND retries > ?`,
    )
    .run(MAX_RETRIES);
  total += cap.changes;

  // Mirror touched rows to Pi. Re-read post-update so the cleared lease /
  // bumped retries / partial-status are reflected. Dedup by composite key.
  const seen = new Set<string>();
  const toMirror: { cluster: string; key: string; scope: Scope }[] = [];
  for (const r of [...lapsed, ...overretried]) {
    const id = `${r.cluster}::${r.period_key}::${r.scope}`;
    if (seen.has(id)) continue;
    seen.add(id);
    toMirror.push({ cluster: r.cluster, key: r.period_key, scope: r.scope });
  }

  for (const t of toMirror) {
    const fresh = read(t.cluster, t.key, t.scope);
    if (!fresh) continue;
    const wrapped = {
      payload: fresh.payload ?? null,
      provenance: fresh.provenance,
    };
    void pushInsightLazy({
      periodKey: t.key,
      scope: t.scope,
      cluster: t.cluster,
      status: fresh.state === "empty" ? "pending" : fresh.state,
      payload: wrapped,
      leasedAt: fresh.leased_at,
      errorText: fresh.error_text,
      retries: fresh.retries,
    }).catch((err) =>
      log.warn("jobs", `sweep Pi-sync ${t.cluster}/${t.key}: ${(err as Error).message}`),
    );
  }

  return total;
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
 * Upsert the cell to status='pending' (if it isn't already) and push the
 * dispatch token onto whichever queue is live. Redis takes precedence; in
 * its absence we use the in-process heap.
 *
 * Lease preservation: the UPDATE branch deliberately does *not* clear
 * `leased_at`. If a worker is currently running this cluster (lease held)
 * and a user clicks "Anfordern" again, we don't yank the lease — the
 * worker finishes the in-flight run, releases (lease=NULL), and the next
 * dispatcher tick picks up the queued item via claim. Without this
 * preservation the dashboard briefly regresses to a CTA card while the
 * old worker is still mid-LLM (Flow D in the state-machine docs).
 *
 * Known limitation: if a click lands while a worker is mid-run, `release()`
 * will set status='complete' and the queued rerun item's subsequent
 * `claim()` will fail (status check). The cluster doesn't re-run from
 * mid-run clicks. Acceptable for now — user sees fresher data from the
 * just-finished run. Proper fix is a separate `rerun_requested` flag or
 * a dispatcher post-release sweep; both schema/architecture changes that
 * we're punting on.
 */
export async function enqueue(opts: EnqueueOpts): Promise<void> {
  const scope: Scope = opts.scope ?? "daily";
  const db = getDb();
  const nowIso = new Date().toISOString();
  // Upsert to pending. If the row already exists in a terminal state
  // (complete / partial / live) we still flip it to pending so the
  // dispatcher picks it up — payload_json is preserved by the absence of
  // a payload_json column in the UPDATE clause, and leased_at is preserved
  // for the same reason (the claim() filter already prevents concurrent
  // re-claim while the lease is held).
  db.prepare(
    `INSERT INTO PULSE_INSIGHT
        (period_key, scope, cluster, version, status, payload_json, source,
         updated_at, started_at, leased_at, error_text, retries)
       VALUES (?, ?, ?, 1, 'pending', '{}', 'dispatcher', ?, NULL, NULL, NULL, 0)
       ON CONFLICT(period_key, scope, cluster) DO UPDATE SET
         status = 'pending',
         updated_at = excluded.updated_at`,
  ).run(opts.key, scope, opts.cluster, nowIso);

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
      const score = -(opts.priority * 1e13) + item.requested_at_ms; // lower = earlier
      await redis.zadd("pulse:jobs:pending", score, JSON.stringify(item));
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("jobs", `redis enqueue failed, fallback in-process: ${msg}`);
    }
  }
  pushQueue(item);
}
