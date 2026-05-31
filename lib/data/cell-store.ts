import "server-only";

import { getWritableDb } from "../db-writable";

/**
 * Pi-side atomic JobCell operations over PULSE_INSIGHT.
 *
 * Mirrors the semantics previously implemented locally on the Mac runner in
 * runner/src/jobs/cell.ts. Hosting these on the Pi means there is exactly
 * one writer of pulse.db (the Pi), which removes the SQLite-over-Syncthing
 * conflict class. The runner reaches each op through HTTP; race-free
 * atomicity is preserved because every UPDATE/INSERT here runs on a single
 * SQLite handle on the Pi.
 */

export type Scope = "daily" | "weekly";
export type InsightStatus = "pending" | "live" | "partial" | "complete";
export type CellState = InsightStatus | "empty";

export interface ProvenanceTag {
  source: string;
  detail?: unknown;
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

export function readCell(
  cluster: string,
  key: string,
  scope: Scope = "daily",
): CellReadResult | null {
  const db = getWritableDb();
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

export function claimCell(
  cluster: string,
  key: string,
  scope: Scope = "daily",
): CellReadResult | null {
  const db = getWritableDb();
  const nowIso = new Date().toISOString();
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
  return readCell(cluster, key, scope);
}

export interface ReleasePayload {
  payload: unknown;
  provenance?: ProvenanceTag[];
}

export function releaseCell(
  cluster: string,
  key: string,
  value: ReleasePayload,
  error: string | null = null,
  scope: Scope = "daily",
): void {
  const db = getWritableDb();
  const status: InsightStatus = error ? "partial" : "complete";
  const nowIso = new Date().toISOString();
  const wrapped = {
    payload: value.payload,
    provenance: value.provenance ?? [],
  };
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
         error_text = excluded.error_text,
         retries = 0`,
  ).run(key, scope, cluster, status, JSON.stringify(wrapped), nowIso, nowIso, error);
}

export function markCellStale(
  cluster: string,
  key: string,
  reason: string,
  scope: Scope = "daily",
): void {
  const db = getWritableDb();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO PULSE_INSIGHT
        (period_key, scope, cluster, version, status, payload_json, source,
         updated_at, started_at, leased_at, error_text, retries)
       VALUES (?, ?, ?, 1, 'pending', '{}', 'dispatcher', ?, NULL, NULL, ?, 0)
       ON CONFLICT(period_key, scope, cluster) DO UPDATE SET
         status = 'pending',
         updated_at = excluded.updated_at,
         leased_at = NULL,
         error_text = excluded.error_text,
         retries = 0`,
  ).run(key, scope, cluster, nowIso, reason);
}

export function enqueueCellPending(
  cluster: string,
  key: string,
  scope: Scope = "daily",
): void {
  const db = getWritableDb();
  const nowIso = new Date().toISOString();
  // Lease preservation on the UPDATE branch is intentional: if a worker is
  // currently running this cluster (lease held) and the user clicks
  // "Anfordern" again, we do NOT yank the lease — the in-flight worker
  // finishes, releases (lease=NULL, retries=0), and the next dispatcher
  // tick picks up the queued item via claim. Mirrors the previous local
  // SQLite behaviour documented in runner/src/jobs/cell.ts pre-refactor.
  db.prepare(
    `INSERT INTO PULSE_INSIGHT
        (period_key, scope, cluster, version, status, payload_json, source,
         updated_at, started_at, leased_at, error_text, retries)
       VALUES (?, ?, ?, 1, 'pending', '{}', 'dispatcher', ?, NULL, NULL, NULL, 0)
       ON CONFLICT(period_key, scope, cluster) DO UPDATE SET
         status = 'pending',
         updated_at = excluded.updated_at`,
  ).run(key, scope, cluster, nowIso);
}

/**
 * Two-pass lease sweep — clear lapsed leases (retries++), then cap rows that
 * exceeded MAX_RETRIES. MAX_RETRIES is passed in so the policy stays on the
 * runner side; this store just executes.
 */
export function sweepCellLeases(ttlMs: number, maxRetries: number): number {
  const db = getWritableDb();
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
  const cap = db
    .prepare(
      `UPDATE PULSE_INSIGHT
          SET status = 'partial',
              error_text = 'max_retries_exceeded'
        WHERE status = 'pending'
          AND leased_at IS NULL
          AND retries > ?`,
    )
    .run(maxRetries);
  total += cap.changes;
  return total;
}
