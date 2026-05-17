import "server-only";

/**
 * Period store — pulse.db rows that replace the file-based insight tree.
 *
 * Pi is the single writer. Mac runner POSTs to /api/ingest/* over Tailscale;
 * those handlers call into this module. Dashboard pages read via the
 * `read*` helpers which use the read-only pulse.db handle.
 *
 * Tables: PULSE_FACTS, PULSE_INSIGHT, PULSE_BUNDLE, PULSE_STATE_KV,
 * PULSE_ALARM_EVENT, PULSE_EVENT_LOG, PULSE_INGEST_LOG.
 */

import type Database from "better-sqlite3";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";

export type Scope = "daily" | "weekly";
export type FactsStatus = "live" | "locked";
export type InsightStatus = "pending" | "live" | "partial" | "complete";
export type BundleStatus = "pending" | "live" | "partial" | "complete";
export type Pipeline = "v2" | "v3";

// ── FACTS ───────────────────────────────────────────────────────────────────

export interface FactsRow<P = unknown> {
  periodKey: string;
  scope: Scope;
  status: FactsStatus;
  payload: P;
  source: string;
  updatedAt: string;
}

export function readFacts<P = unknown>(
  periodKey: string,
  scope: Scope = "daily",
): FactsRow<P> | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<
        [string, Scope],
        {
          period_key: string;
          scope: Scope;
          status: FactsStatus;
          payload_json: string;
          source: string;
          updated_at: string;
        }
      >(
        `SELECT period_key, scope, status, payload_json, source, updated_at
         FROM PULSE_FACTS
         WHERE period_key = ? AND scope = ?`,
      )
      .get(periodKey, scope);
    if (!row) return null;
    return {
      periodKey: row.period_key,
      scope: row.scope,
      status: row.status,
      payload: JSON.parse(row.payload_json) as P,
      source: row.source,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export interface WriteFactsInput {
  periodKey: string;
  scope?: Scope;
  status: FactsStatus;
  payload: unknown;
  source?: string;
}

export function writeFacts(input: WriteFactsInput): void {
  const db = getWritableDb();
  const scope = input.scope ?? "daily";
  const source = input.source ?? "runner";
  db.prepare(
    `INSERT INTO PULSE_FACTS (period_key, scope, status, payload_json, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(period_key, scope) DO UPDATE SET
       status = excluded.status,
       payload_json = excluded.payload_json,
       source = excluded.source,
       updated_at = excluded.updated_at`,
  ).run(
    input.periodKey,
    scope,
    input.status,
    JSON.stringify(input.payload),
    source,
    new Date().toISOString(),
  );
}

// ── INSIGHTS (per cluster) ───────────────────────────────────────────────────

export interface InsightRow<P = unknown> {
  periodKey: string;
  scope: Scope;
  cluster: string;
  version: number;
  status: InsightStatus;
  payload: P;
  source: string;
  updatedAt: string;
}

export function readInsight<P = unknown>(
  periodKey: string,
  cluster: string,
  scope: Scope = "daily",
): InsightRow<P> | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<
        [string, Scope, string],
        {
          period_key: string;
          scope: Scope;
          cluster: string;
          version: number;
          status: InsightStatus;
          payload_json: string;
          source: string;
          updated_at: string;
        }
      >(
        `SELECT period_key, scope, cluster, version, status, payload_json, source, updated_at
         FROM PULSE_INSIGHT
         WHERE period_key = ? AND scope = ? AND cluster = ?`,
      )
      .get(periodKey, scope, cluster);
    if (!row) return null;
    return {
      periodKey: row.period_key,
      scope: row.scope,
      cluster: row.cluster,
      version: row.version,
      status: row.status,
      payload: JSON.parse(row.payload_json) as P,
      source: row.source,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function listInsights(
  periodKey: string,
  scope: Scope = "daily",
): InsightRow[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<
        [string, Scope],
        {
          period_key: string;
          scope: Scope;
          cluster: string;
          version: number;
          status: InsightStatus;
          payload_json: string;
          source: string;
          updated_at: string;
        }
      >(
        `SELECT period_key, scope, cluster, version, status, payload_json, source, updated_at
         FROM PULSE_INSIGHT
         WHERE period_key = ? AND scope = ?
         ORDER BY cluster`,
      )
      .all(periodKey, scope);
    return rows.map((row) => ({
      periodKey: row.period_key,
      scope: row.scope,
      cluster: row.cluster,
      version: row.version,
      status: row.status,
      payload: JSON.parse(row.payload_json),
      source: row.source,
      updatedAt: row.updated_at,
    }));
  } catch {
    return [];
  }
}

export interface WriteInsightInput {
  periodKey: string;
  scope?: Scope;
  cluster: string;
  status: InsightStatus;
  payload: unknown;
  source?: string;
}

export function writeInsight(input: WriteInsightInput): void {
  const db = getWritableDb();
  const scope = input.scope ?? "daily";
  const source = input.source ?? "runner";
  db.prepare(
    `INSERT INTO PULSE_INSIGHT
       (period_key, scope, cluster, version, status, payload_json, source, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(period_key, scope, cluster) DO UPDATE SET
       version = PULSE_INSIGHT.version + 1,
       status = excluded.status,
       payload_json = excluded.payload_json,
       source = excluded.source,
       updated_at = excluded.updated_at`,
  ).run(
    input.periodKey,
    scope,
    input.cluster,
    input.status,
    JSON.stringify(input.payload),
    source,
    new Date().toISOString(),
  );
}

// ── BUNDLE (pipeline-level status + per-stage log) ──────────────────────────

export interface BundleRow {
  periodKey: string;
  scope: Scope;
  status: BundleStatus;
  pipeline: Pipeline;
  stages: unknown;
  verify: unknown;
  updatedAt: string;
}

export function readBundle(
  periodKey: string,
  pipeline: Pipeline = "v2",
  scope: Scope = "daily",
): BundleRow | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<
        [string, Scope, Pipeline],
        {
          period_key: string;
          scope: Scope;
          status: BundleStatus;
          pipeline: Pipeline;
          stages_json: string;
          verify_json: string | null;
          updated_at: string;
        }
      >(
        `SELECT period_key, scope, status, pipeline, stages_json, verify_json, updated_at
         FROM PULSE_BUNDLE
         WHERE period_key = ? AND scope = ? AND pipeline = ?`,
      )
      .get(periodKey, scope, pipeline);
    if (!row) return null;
    return {
      periodKey: row.period_key,
      scope: row.scope,
      status: row.status,
      pipeline: row.pipeline,
      stages: JSON.parse(row.stages_json),
      verify: row.verify_json ? JSON.parse(row.verify_json) : null,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export interface WriteBundleInput {
  periodKey: string;
  scope?: Scope;
  pipeline?: Pipeline;
  status: BundleStatus;
  stages: unknown;
  verify?: unknown;
}

export function writeBundle(input: WriteBundleInput): void {
  const db = getWritableDb();
  const scope = input.scope ?? "daily";
  const pipeline = input.pipeline ?? "v2";
  db.prepare(
    `INSERT INTO PULSE_BUNDLE
       (period_key, scope, pipeline, status, stages_json, verify_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(period_key, scope, pipeline) DO UPDATE SET
       status = excluded.status,
       stages_json = excluded.stages_json,
       verify_json = excluded.verify_json,
       updated_at = excluded.updated_at`,
  ).run(
    input.periodKey,
    scope,
    pipeline,
    input.status,
    JSON.stringify(input.stages),
    input.verify === undefined ? null : JSON.stringify(input.verify),
    new Date().toISOString(),
  );
}

// ── STATE KV (pause/labs/...) ────────────────────────────────────────────────

export function readStateKv<T = unknown>(key: string): T | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], { value_json: string }>(
        `SELECT value_json FROM PULSE_STATE_KV WHERE key = ?`,
      )
      .get(key);
    return row ? (JSON.parse(row.value_json) as T) : null;
  } catch {
    return null;
  }
}

export function writeStateKv(key: string, value: unknown): void {
  const db = getWritableDb();
  db.prepare(
    `INSERT INTO PULSE_STATE_KV (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

// ── ALARM EVENTS ─────────────────────────────────────────────────────────────

export interface AlarmEventInput {
  id: string;
  periodKey: string;
  tsIso: string;
  kind: string;
  severity: string;
  payload: unknown;
}

export function writeAlarmEvent(input: AlarmEventInput): void {
  const db = getWritableDb();
  db.prepare(
    `INSERT OR IGNORE INTO PULSE_ALARM_EVENT
       (id, period_key, ts_iso, kind, severity, payload_json, state)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
  ).run(
    input.id,
    input.periodKey,
    input.tsIso,
    input.kind,
    input.severity,
    JSON.stringify(input.payload),
  );
}

export function updateAlarmState(
  id: string,
  patch: { state?: "active" | "dismissed" | "snoozed"; dismissed_at?: string; snooze_until?: string },
): void {
  const db = getWritableDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.state !== undefined) {
    fields.push("state = ?");
    values.push(patch.state);
  }
  if (patch.dismissed_at !== undefined) {
    fields.push("dismissed_at = ?");
    values.push(patch.dismissed_at);
  }
  if (patch.snooze_until !== undefined) {
    fields.push("snooze_until = ?");
    values.push(patch.snooze_until);
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE PULSE_ALARM_EVENT SET ${fields.join(", ")} WHERE id = ?`).run(
    ...(values as never[]),
  );
}

// ── INGEST DEDUPE ────────────────────────────────────────────────────────────

/**
 * Records an idempotency key for the given endpoint. Returns `true` when
 * this is the first time we've seen the key (caller should proceed with the
 * write), `false` when it's a duplicate (caller should short-circuit and
 * return 200 — the original write already happened).
 */
export function claimIngestKey(
  idempotencyKey: string,
  endpoint: string,
  periodKey: string | null,
): boolean {
  const db = getWritableDb();
  try {
    const info = db
      .prepare(
        `INSERT INTO PULSE_INGEST_LOG (idempotency_key, endpoint, period_key)
         VALUES (?, ?, ?)`,
      )
      .run(idempotencyKey, endpoint, periodKey);
    return info.changes > 0;
  } catch (err) {
    // UNIQUE collision → duplicate
    if (err instanceof Error && /UNIQUE/i.test(err.message)) return false;
    throw err;
  }
}

// ── EVENT LOG ────────────────────────────────────────────────────────────────

export interface EventLogInput {
  id: string;
  kind: string;
  periodKey: string;
  tsMs: number;
  payload: unknown;
}

export function writeEventLog(input: EventLogInput): boolean {
  const db = getWritableDb();
  try {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO PULSE_EVENT_LOG (id, kind, period_key, ts_ms, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.kind, input.periodKey, input.tsMs, JSON.stringify(input.payload));
    return info.changes > 0;
  } catch {
    return false;
  }
}

// ── ATOMIC PERIOD WRITE ──────────────────────────────────────────────────────

export interface AtomicPeriodWrite {
  periodKey: string;
  scope?: Scope;
  /** Facts row (always written when present). */
  facts?: { status: FactsStatus; payload: unknown; source?: string };
  /** Zero or more insight rows (cluster-keyed). */
  insights?: Array<{ cluster: string; status: InsightStatus; payload: unknown; source?: string }>;
  /** Bundle row. */
  bundle?: {
    pipeline?: Pipeline;
    status: BundleStatus;
    stages: unknown;
    verify?: unknown;
  };
}

/**
 * Write facts + insight(s) + bundle for one period in a single SQLite
 * transaction. Eliminates the three-POST read window where a dashboard
 * fetch could see locked facts paired with stale/missing insight rows.
 *
 * The Mac runner calls this through `POST /api/ingest/period_atomic` at
 * pipeline finalize time, instead of three separate POSTs.
 */
export function writePeriodAtomic(input: AtomicPeriodWrite): void {
  const db = getWritableDb();
  const scope = input.scope ?? "daily";
  const nowIso = new Date().toISOString();

  const factsStmt = db.prepare(
    `INSERT INTO PULSE_FACTS (period_key, scope, status, payload_json, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(period_key, scope) DO UPDATE SET
       status = excluded.status,
       payload_json = excluded.payload_json,
       source = excluded.source,
       updated_at = excluded.updated_at`,
  );

  const insightStmt = db.prepare(
    `INSERT INTO PULSE_INSIGHT
       (period_key, scope, cluster, version, status, payload_json, source, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(period_key, scope, cluster) DO UPDATE SET
       version = PULSE_INSIGHT.version + 1,
       status = excluded.status,
       payload_json = excluded.payload_json,
       source = excluded.source,
       updated_at = excluded.updated_at`,
  );

  const bundleStmt = db.prepare(
    `INSERT INTO PULSE_BUNDLE
       (period_key, scope, pipeline, status, stages_json, verify_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(period_key, scope, pipeline) DO UPDATE SET
       status = excluded.status,
       stages_json = excluded.stages_json,
       verify_json = excluded.verify_json,
       updated_at = excluded.updated_at`,
  );

  const tx = db.transaction(() => {
    if (input.facts) {
      factsStmt.run(
        input.periodKey,
        scope,
        input.facts.status,
        JSON.stringify(input.facts.payload),
        input.facts.source ?? "runner",
        nowIso,
      );
    }
    for (const i of input.insights ?? []) {
      insightStmt.run(
        input.periodKey,
        scope,
        i.cluster,
        i.status,
        JSON.stringify(i.payload),
        i.source ?? "runner",
        nowIso,
      );
    }
    if (input.bundle) {
      bundleStmt.run(
        input.periodKey,
        scope,
        input.bundle.pipeline ?? "v2",
        input.bundle.status,
        JSON.stringify(input.bundle.stages),
        input.bundle.verify === undefined ? null : JSON.stringify(input.bundle.verify),
        nowIso,
      );
    }
  });
  tx();
}

// ── COMBINED PERIOD VIEW (for the dashboard) ─────────────────────────────────

export interface PeriodView {
  periodKey: string;
  facts: FactsRow | null;
  insights: Record<string, InsightRow>;
  bundle: BundleRow | null;
  /** Highest-level UI status: 'absent' | 'live' | 'partial' | 'complete' */
  status: "absent" | "live" | "partial" | "complete";
}

/** Roll up the period into one struct for an SSR page. */
export function readPeriodView(
  periodKey: string,
  scope: Scope = "daily",
): PeriodView {
  const facts = readFacts(periodKey, scope);
  const insights = listInsights(periodKey, scope);
  const bundle = readBundle(periodKey, "v2", scope);

  const insightMap: Record<string, InsightRow> = {};
  for (const i of insights) insightMap[i.cluster] = i;

  let status: PeriodView["status"] = "absent";
  if (facts) {
    status = "live";
    if (bundle) {
      status =
        bundle.status === "complete"
          ? "complete"
          : bundle.status === "partial"
            ? "partial"
            : "live";
    }
  }
  return { periodKey, facts, insights: insightMap, bundle, status };
}

/**
 * The dashboard reads use the read-only handle. Tests sometimes need direct
 * access to the writable connection to bootstrap fixtures.
 */
export function _writableHandleForTests(): Database.Database {
  return getWritableDb();
}
