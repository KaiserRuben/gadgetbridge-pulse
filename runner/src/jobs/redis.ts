/**
 * Lazy ioredis singleton. Returns `null` when REDIS_URL is unset or the
 * connect attempt fails — callers fall back to in-process queue / mutex.
 */

import { createRequire } from "node:module";

import { log } from "../logger.ts";

type RedisClientLike = {
  set: (...args: unknown[]) => Promise<unknown>;
  del: (...args: unknown[]) => Promise<unknown>;
  expire: (...args: unknown[]) => Promise<unknown>;
  eval: (...args: unknown[]) => Promise<unknown>;
  zadd: (...args: unknown[]) => Promise<unknown>;
  zpopmin: (...args: unknown[]) => Promise<unknown>;
  zcard: (...args: unknown[]) => Promise<unknown>;
  quit: () => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

let _client: RedisClientLike | null = null;
let _initAttempted = false;

/**
 * Returns an ioredis client, or `null` if REDIS_URL is unset or the module
 * cannot be loaded. Fail-open by design: we never throw out of this fn so a
 * missing Redis just degrades the runner to in-process queue + mutex.
 */
export function getRedis(): RedisClientLike | null {
  if (_client) return _client;
  if (_initAttempted) return null;
  _initAttempted = true;

  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;

  try {
    const mod = loadIoredis();
    if (!mod) return null;
    const ctor = (mod.default ?? mod) as new (url: string) => RedisClientLike;
    const client = new ctor(url);
    client.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("jobs", `redis error: ${msg}`);
    });
    _client = client;
    log.info("jobs", `redis connected ${url.replace(/:[^@]*@/, ":***@")}`);
    return _client;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("jobs", `redis init failed: ${msg}`);
    _client = null;
    return null;
  }
}

/** Test helper — forces re-init on next `getRedis()` and tears down state. */
export function _resetRedisForTests(): void {
  if (_client) {
    void _client.quit().catch(() => undefined);
  }
  _client = null;
  _initAttempted = false;
}

function loadIoredis(): { default?: unknown } | null {
  // createRequire so we can require() a CJS module under ESM without forcing
  // a static import (which would fail when ioredis isn't installed).
  try {
    const req = createRequire(import.meta.url);
    return req("ioredis") as { default?: unknown };
  } catch {
    return null;
  }
}
