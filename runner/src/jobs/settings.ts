/**
 * Runtime settings reader — auto-process flag (per cluster + global) and
 * critic model toggle. Backed by PULSE_STATE_KV.
 *
 * 60-second in-process cache: settings are written by the dashboard UI so a
 * read every job-dispatch tick would otherwise hammer pulse.db with point
 * queries. Cache TTL is short enough that a setting flip propagates within
 * a minute without operator action.
 */

import type Database from "better-sqlite3";

import { getWritableDb } from "../db-writable.ts";

/**
 * OQ-5 per-cluster auto-process defaults. Mirrors `CLUSTER_COPY` in
 * `lib/derived/cluster-copy.ts` (dashboard-side) so the runner-side
 * default ladder is decoupled from the dashboard build. Kept as a flat
 * Record because the runner doesn't import dashboard modules.
 *
 * Resolution order for `readAutoProcessSetting(cluster)`:
 *   1. per-cluster key `settings:auto_process:<cluster>` (user override)
 *   2. global key `settings:auto_process` (user master switch)
 *   3. CLUSTER_AUTO_DEFAULTS[cluster] (this map)
 *   4. `false` (conservative fallback for unknown clusters)
 */
const CLUSTER_AUTO_DEFAULTS: Record<string, boolean> = {
  synthesis_v3: true,
  morning_insight: true,
  weekly_recap: true,
  anomaly_explain: true,
};

const TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expires_at: number;
}

let _dbOverride: Database.Database | null = null;
const _cache = new Map<string, CacheEntry<unknown>>();

export function setSettingsDb(db: Database.Database | null): void {
  _dbOverride = db;
}

export function _resetSettingsForTests(): void {
  _cache.clear();
  _dbOverride = null;
}

function getDb(): Database.Database {
  return _dbOverride ?? getWritableDb();
}

function readKv<T>(key: string): T | null {
  try {
    const row = getDb()
      .prepare<[string], { value_json: string }>(
        `SELECT value_json FROM PULSE_STATE_KV WHERE key = ?`,
      )
      .get(key);
    if (!row) return null;
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

function fromCache<T>(key: string, now: number): { hit: true; value: T } | { hit: false } {
  const ent = _cache.get(key);
  if (!ent || ent.expires_at < now) return { hit: false };
  return { hit: true, value: ent.value as T };
}

function toCache(key: string, value: unknown, now: number): void {
  _cache.set(key, { value, expires_at: now + TTL_MS });
}

function asBoolean(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (v && typeof v === "object" && "enabled" in v) {
    const inner = (v as { enabled?: unknown }).enabled;
    if (typeof inner === "boolean") return inner;
  }
  return null;
}

/**
 * Per-cluster auto-process flag. Tries the cluster-scoped key first
 * (`settings:auto_process:<cluster>`); falls back to the global key
 * (`settings:auto_process`); finally falls back to the per-cluster
 * default in `CLUSTER_AUTO_DEFAULTS`. Unknown clusters default `false`.
 */
export async function readAutoProcessSetting(cluster: string): Promise<boolean> {
  const perCluster = `settings:auto_process:${cluster}`;
  const now = Date.now();
  const cached = fromCache<boolean>(perCluster, now);
  if (cached.hit) return cached.value;

  const local = asBoolean(readKv<unknown>(perCluster));
  if (local !== null) {
    toCache(perCluster, local, now);
    return local;
  }
  const global = asBoolean(readKv<unknown>("settings:auto_process"));
  const resolved = global ?? CLUSTER_AUTO_DEFAULTS[cluster] ?? false;
  toCache(perCluster, resolved, now);
  return resolved;
}

/**
 * Whether the critic model gate runs after Stage 5 prose. Falls back to
 * `false` when unset so a fresh install doesn't burn GPU on a second pass.
 */
export async function readCriticEnabled(): Promise<boolean> {
  const key = "settings:critic_model";
  const now = Date.now();
  const cached = fromCache<boolean>(key, now);
  if (cached.hit) return cached.value;

  const v = asBoolean(readKv<unknown>(key));
  const resolved = v ?? false;
  toCache(key, resolved, now);
  return resolved;
}
