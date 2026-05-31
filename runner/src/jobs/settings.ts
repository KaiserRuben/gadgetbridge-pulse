/**
 * Runtime settings reader — auto-process flag (per cluster + global) and
 * critic model toggle. Backed by PULSE_STATE_KV on the Pi, reached via
 * GET /api/state-kv/<key>.
 *
 * 60-second in-process cache: settings change at human speed (dashboard
 * toggles); a read every job-dispatch tick would otherwise hammer the Pi.
 */

import { piStateKvGet } from "../ingest/client.ts";

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

const _cache = new Map<string, CacheEntry<unknown>>();

export function _resetSettingsForTests(): void {
  _cache.clear();
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

  const local = asBoolean(await piStateKvGet<unknown>(perCluster));
  if (local !== null) {
    toCache(perCluster, local, now);
    return local;
  }
  const global = asBoolean(await piStateKvGet<unknown>("settings:auto_process"));
  const resolved = global ?? CLUSTER_AUTO_DEFAULTS[cluster] ?? false;
  toCache(perCluster, resolved, now);
  return resolved;
}

export async function readCriticEnabled(): Promise<boolean> {
  const key = "settings:critic_model";
  const now = Date.now();
  const cached = fromCache<boolean>(key, now);
  if (cached.hit) return cached.value;

  const v = asBoolean(await piStateKvGet<unknown>(key));
  const resolved = v ?? false;
  toCache(key, resolved, now);
  return resolved;
}
