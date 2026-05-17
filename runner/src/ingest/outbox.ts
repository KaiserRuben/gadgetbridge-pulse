/**
 * Ingest outbox — local SQLite queue on the Mac runner.
 *
 * When the Pi is unreachable (Tailscale flap, Pi restart, 5xx burst) the
 * client enqueues the request here and a background flusher retries with
 * exponential backoff. Survives runner restarts; never loses a write.
 *
 * Schema: one row per pending POST, keyed by idempotency-key. Replay sends
 * the same key so the Pi's PULSE_INGEST_LOG dedupes.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

import { config } from "../config.ts";

interface PendingRow {
  idem_key: string;
  kind: string;
  body_json: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
}

let _db: Database.Database | null = null;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(config.ingestOutboxPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(config.ingestOutboxPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS OUTBOX (
      idem_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      body_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_next ON OUTBOX(next_attempt_at);
  `);
  _db = db;
  return db;
}

export interface EnqueueInput {
  kind: string;
  body: Record<string, unknown>;
  idemKey: string;
}

/**
 * Per-(kind, periodKey) cap. Live facts get rewritten every watch-debounce
 * tick (~2s) — during an extended Pi outage that would balloon the outbox
 * to tens of thousands of stale rows. Cap keeps only the N freshest entries
 * per stream; older live snapshots are obsolete the moment a newer one
 * arrives, so dropping them is harmless.
 */
const MAX_PER_STREAM = 50;

export function enqueue(input: EnqueueInput): void {
  if (!config.ingestBaseUrl) return;
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO OUTBOX (idem_key, kind, body_json, attempts, next_attempt_at, last_error)
     VALUES (?, ?, ?,
       COALESCE((SELECT attempts FROM OUTBOX WHERE idem_key = ?), 0),
       ?,
       NULL)`,
  ).run(
    input.idemKey,
    input.kind,
    JSON.stringify(input.body),
    input.idemKey,
    new Date(Date.now() + 2_000).toISOString(),
  );

  // Trim: keep only the freshest MAX_PER_STREAM rows for this (kind, period).
  // The idem_key for `facts`/`bundle`/`insight` starts with
  // `${kind}|${periodKey}|...`; we LIKE-match by that prefix and prune by
  // created_at ascending.
  const body = input.body as { periodKey?: string };
  const periodKey = body.periodKey ?? "";
  if (periodKey) {
    const prefix = `${input.kind}|${periodKey}|%`;
    db.prepare(
      `DELETE FROM OUTBOX
       WHERE idem_key LIKE ?
         AND idem_key NOT IN (
           SELECT idem_key FROM OUTBOX
           WHERE idem_key LIKE ?
           ORDER BY created_at DESC
           LIMIT ?
         )`,
    ).run(prefix, prefix, MAX_PER_STREAM);
  }

  scheduleFlush(2_000);
}

export function outboxSize(): number {
  const db = getDb();
  const row = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM OUTBOX`).get();
  return row?.n ?? 0;
}

function backoffMs(attempts: number): number {
  // 2s · 4s · 8s · 16s · 32s · 60s capped.
  return Math.min(2_000 * 2 ** attempts, 60_000);
}

function scheduleFlush(delayMs: number): void {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    void flush();
  }, delayMs);
}

async function flush(): Promise<void> {
  if (!config.ingestBaseUrl) return;
  const db = getDb();
  const due = db
    .prepare<[string], PendingRow>(
      `SELECT idem_key, kind, body_json, attempts, next_attempt_at, last_error, created_at
       FROM OUTBOX
       WHERE next_attempt_at <= ?
       ORDER BY next_attempt_at
       LIMIT 25`,
    )
    .all(new Date().toISOString());

  if (due.length === 0) return;

  for (const row of due) {
    const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}/api/ingest/${row.kind}`;
    let ok = false;
    let err: string | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": row.idem_key,
          ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
        },
        body: row.body_json,
      });
      ok = res.ok;
      if (!ok) err = `HTTP ${res.status}`;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }

    if (ok) {
      db.prepare(`DELETE FROM OUTBOX WHERE idem_key = ?`).run(row.idem_key);
    } else {
      const next = new Date(Date.now() + backoffMs(row.attempts + 1)).toISOString();
      db.prepare(
        `UPDATE OUTBOX SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE idem_key = ?`,
      ).run(next, err, row.idem_key);
    }
  }

  // If anything remains, schedule another flush at the earliest due time.
  const next = db
    .prepare<[], { next_attempt_at: string }>(
      `SELECT MIN(next_attempt_at) AS next_attempt_at FROM OUTBOX`,
    )
    .get();
  if (next?.next_attempt_at) {
    const delay = Math.max(500, new Date(next.next_attempt_at).getTime() - Date.now());
    scheduleFlush(delay);
  }
}

/**
 * Start a permanent flusher. Call once from long-running CLIs (events-loop,
 * v2/v3 finalize loop). One-shot scripts can skip — `enqueue()` already
 * schedules a near-immediate flush.
 */
export function startOutboxFlusher(): void {
  if (!config.ingestBaseUrl) return;
  scheduleFlush(2_000);
  setInterval(() => scheduleFlush(0), 30_000).unref();
}
