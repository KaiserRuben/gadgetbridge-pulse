import "server-only";

import { getWritableDb } from "../db-writable";
import { pulseDbOrThrow } from "../pulse-db";

/**
 * PULSE_RUN — runner observability store.
 *
 * Captures every stage / cluster / LLM call the runner executes so the
 * dashboard can answer "what is running right now?" without scraping logs.
 * The runner POSTs to /api/ingest/run with one of three ops (start /
 * heartbeat / finish); each op lands here.
 *
 * Authoritative writer: the runner (Mac). Reader: dashboard + worker boot
 * recovery sweep. The Pi mutates rows on behalf of the runner so the
 * single-writer pulse.db invariant holds even though the "owner" of the
 * data conceptually lives on the runner.
 */

export type RunStatus = "queued" | "running" | "ok" | "fail" | "orphaned";
export type RunScope = "daily" | "weekly" | "instant";

export interface RunUpsertInput {
  run_id: string;
  cluster: string;
  key: string;
  scope?: RunScope;
  stage?: string | null;
  attempt?: number;
  status: RunStatus;
  started_at?: string | null;
  last_heartbeat_at?: string | null;
  finished_at?: string | null;
  elapsed_ms?: number | null;
  prompt_chars?: number | null;
  eval_tokens?: number | null;
  error_text?: string | null;
  parent_run_id?: string | null;
  meta_json?: string | null;
  host?: string | null;
}

export interface RunRow {
  run_id: string;
  cluster: string;
  key: string;
  scope: RunScope;
  stage: string | null;
  attempt: number;
  status: RunStatus;
  started_at: string | null;
  last_heartbeat_at: string | null;
  finished_at: string | null;
  elapsed_ms: number | null;
  prompt_chars: number | null;
  eval_tokens: number | null;
  error_text: string | null;
  parent_run_id: string | null;
  meta_json: string | null;
  host: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * UPSERT a run row. Existing fields are preserved when the incoming value
 * is `undefined` (NOT null — null is a deliberate clear). This lets the
 * runner send sparse updates: a "heartbeat" only carries `last_heartbeat_at`,
 * a "finish" carries `status + finished_at + elapsed_ms + error_text`.
 */
export function upsertRun(input: RunUpsertInput): void {
  const db = getWritableDb();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO PULSE_RUN
        (run_id, cluster, key, scope, stage, attempt, status,
         started_at, last_heartbeat_at, finished_at, elapsed_ms,
         prompt_chars, eval_tokens, error_text, parent_run_id,
         meta_json, host, created_at, updated_at)
       VALUES (@run_id, @cluster, @key, @scope, @stage, @attempt, @status,
               @started_at, @last_heartbeat_at, @finished_at, @elapsed_ms,
               @prompt_chars, @eval_tokens, @error_text, @parent_run_id,
               @meta_json, @host, @now, @now)
       ON CONFLICT(run_id) DO UPDATE SET
         status            = excluded.status,
         stage             = COALESCE(excluded.stage,             PULSE_RUN.stage),
         attempt           = COALESCE(excluded.attempt,           PULSE_RUN.attempt),
         started_at        = COALESCE(excluded.started_at,        PULSE_RUN.started_at),
         last_heartbeat_at = COALESCE(excluded.last_heartbeat_at, PULSE_RUN.last_heartbeat_at),
         finished_at       = COALESCE(excluded.finished_at,       PULSE_RUN.finished_at),
         elapsed_ms        = COALESCE(excluded.elapsed_ms,        PULSE_RUN.elapsed_ms),
         prompt_chars      = COALESCE(excluded.prompt_chars,      PULSE_RUN.prompt_chars),
         eval_tokens       = COALESCE(excluded.eval_tokens,       PULSE_RUN.eval_tokens),
         error_text        = COALESCE(excluded.error_text,        PULSE_RUN.error_text),
         meta_json         = COALESCE(excluded.meta_json,         PULSE_RUN.meta_json),
         host              = COALESCE(excluded.host,              PULSE_RUN.host),
         updated_at        = @now`,
  ).run({
    run_id: input.run_id,
    cluster: input.cluster,
    key: input.key,
    scope: input.scope ?? "daily",
    stage: input.stage ?? null,
    attempt: input.attempt ?? 1,
    status: input.status,
    started_at: input.started_at ?? null,
    last_heartbeat_at: input.last_heartbeat_at ?? null,
    finished_at: input.finished_at ?? null,
    elapsed_ms: input.elapsed_ms ?? null,
    prompt_chars: input.prompt_chars ?? null,
    eval_tokens: input.eval_tokens ?? null,
    error_text: input.error_text ?? null,
    parent_run_id: input.parent_run_id ?? null,
    meta_json: input.meta_json ?? null,
    host: input.host ?? null,
    now: nowIso,
  });
}

/**
 * Mark every still-`running` row as `orphaned` and stamp finished_at. Called
 * from the runner boot path so a fresh container doesn't show ghost in-flight
 * rows from the previous process. Returns the count for the recovery banner.
 */
export function markOrphans(olderThanMs: number = 0): number {
  const db = getWritableDb();
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const r = db
    .prepare(
      `UPDATE PULSE_RUN
          SET status = 'orphaned',
              finished_at = COALESCE(finished_at, ?),
              error_text = COALESCE(error_text, 'orphaned_by_recovery'),
              updated_at = ?
        WHERE status IN ('queued','running')
          AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= ?)`,
    )
    .run(cutoff, cutoff, cutoff);
  return r.changes;
}

// ── Read paths (RSC + /api/runner/status) ───────────────────────────────────

interface DbRow {
  run_id: string;
  cluster: string;
  key: string;
  scope: string;
  stage: string | null;
  attempt: number;
  status: string;
  started_at: string | null;
  last_heartbeat_at: string | null;
  finished_at: string | null;
  elapsed_ms: number | null;
  prompt_chars: number | null;
  eval_tokens: number | null;
  error_text: string | null;
  parent_run_id: string | null;
  meta_json: string | null;
  host: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRun(row: DbRow): RunRow {
  return {
    ...row,
    scope: (row.scope as RunScope) ?? "daily",
    status: (row.status as RunStatus) ?? "ok",
  };
}

export function listInFlight(): RunRow[] {
  const db = pulseDbOrThrow();
  return db
    .prepare<[], DbRow>(
      `SELECT * FROM PULSE_RUN
        WHERE status IN ('queued','running')
        ORDER BY COALESCE(started_at, created_at) ASC`,
    )
    .all()
    .map(rowToRun);
}

export function listRecent(limit: number = 30, status?: RunStatus): RunRow[] {
  const db = pulseDbOrThrow();
  const rows = status
    ? db
        .prepare<[string, number], DbRow>(
          `SELECT * FROM PULSE_RUN
            WHERE status = ?
            ORDER BY COALESCE(finished_at, updated_at) DESC
            LIMIT ?`,
        )
        .all(status, limit)
    : db
        .prepare<[number], DbRow>(
          `SELECT * FROM PULSE_RUN
            WHERE status IN ('ok','fail','orphaned')
            ORDER BY COALESCE(finished_at, updated_at) DESC
            LIMIT ?`,
        )
        .all(limit);
  return rows.map(rowToRun);
}

export interface ClusterStats {
  cluster: string;
  count: number;
  ok_count: number;
  fail_count: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

/**
 * Per-cluster duration percentiles over the last `limit` finished runs.
 * Computed in SQL via a window function so the wire stays small even with
 * thousands of historical rows.
 */
export function clusterStats(perCluster: number = 50): ClusterStats[] {
  const db = pulseDbOrThrow();
  // SQLite window functions support percentile via NTILE buckets; for a
  // small dataset we sort + index in JS which is simpler and exact.
  const rows = db
    .prepare<[number], { cluster: string; elapsed_ms: number; status: string }>(
      `WITH ranked AS (
         SELECT cluster, elapsed_ms, status,
                ROW_NUMBER() OVER (PARTITION BY cluster ORDER BY finished_at DESC) AS rn
           FROM PULSE_RUN
          WHERE elapsed_ms IS NOT NULL
            AND status IN ('ok','fail')
       )
       SELECT cluster, elapsed_ms, status FROM ranked WHERE rn <= ?`,
    )
    .all(perCluster);

  const grouped = new Map<string, number[]>();
  const okCounts = new Map<string, number>();
  const failCounts = new Map<string, number>();
  for (const r of rows) {
    const arr = grouped.get(r.cluster) ?? [];
    arr.push(r.elapsed_ms);
    grouped.set(r.cluster, arr);
    if (r.status === "ok") okCounts.set(r.cluster, (okCounts.get(r.cluster) ?? 0) + 1);
    if (r.status === "fail") failCounts.set(r.cluster, (failCounts.get(r.cluster) ?? 0) + 1);
  }
  const out: ClusterStats[] = [];
  for (const [cluster, samples] of grouped) {
    const sorted = samples.slice().sort((a, b) => a - b);
    const pct = (p: number): number => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
      return sorted[idx];
    };
    out.push({
      cluster,
      count: sorted.length,
      ok_count: okCounts.get(cluster) ?? 0,
      fail_count: failCounts.get(cluster) ?? 0,
      p50_ms: pct(0.5),
      p95_ms: pct(0.95),
      max_ms: sorted[sorted.length - 1] ?? null,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
