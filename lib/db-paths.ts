/**
 * Shared DB-path resolution.
 *
 * Two distinct files now:
 *   - `Gadgetbridge.db` — exported by Android Gadgetbridge, replaced wholesale
 *     by Syncthing on every phone push. Read-only, source-of-truth for sensor
 *     data. Resolved by `resolveDbPath()`.
 *   - `pulse.db`        — Pulse-owned sidecar holding all `PULSE_*` tables.
 *     Persistent across Gadgetbridge re-exports. Writable. Resolved by
 *     `resolvePulseDbPath()`.
 *
 * Both the read-only handles (`lib/db.ts`, `runner/src/db.ts`) and the
 * write-only handles (`lib/db-writable.ts`, `runner/src/db-writable.ts`) need
 * to agree on these paths exactly — otherwise WAL gets created in the wrong
 * directory and Syncthing starts shipping confused state. This module
 * centralises the lookup.
 *
 * Resolution order for Gadgetbridge.db:
 *   1. GADGETBRIDGE_DB_PATH env var (explicit)
 *   2. ../Gadgetbridge.db relative to cwd (Next.js dev convention)
 *   3. ./pulse/Gadgetbridge.db (default)
 *
 * Resolution order for pulse.db:
 *   1. PULSE_DB_PATH env var (explicit)
 *   2. ../pulse.db relative to cwd (Next.js dev convention)
 *   3. ./pulse/pulse.db (default)
 *
 * The runner config has its own resolution rooted in PULSE_ROOT — if the
 * caller already has a path, skip this and pass it directly.
 *
 * `resolvePulseDbPath()` does NOT require the file to exist — pulse.db is
 * created on first writable open. It returns the canonical path and lets the
 * caller decide whether to create or fail.
 */

import { existsSync } from "node:fs";
import path from "node:path";

let _cached: string | null = null;
let _pulseCached: string | null = null;

export function resolveDbPath(): string {
  if (_cached) return _cached;
  const candidates = [
    process.env.GADGETBRIDGE_DB_PATH,
    path.join(process.cwd(), "..", "Gadgetbridge.db"),
    "./pulse/Gadgetbridge.db",
  ].filter((p): p is string => Boolean(p));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Gadgetbridge.db not found. Set GADGETBRIDGE_DB_PATH. Tried:\n${candidates.join("\n")}`,
    );
  }
  _cached = found;
  return found;
}

/**
 * Resolve the canonical pulse.db path. Does NOT require the file to exist —
 * `getWritableDb()` creates it on first open with the migrations baked in.
 *
 * Order:
 *   1. PULSE_DB_PATH env var
 *   2. ../pulse.db relative to cwd (sibling of the Next.js dev process)
 *   3. ./pulse/pulse.db (default)
 *
 * If the env var or cwd-relative path is set we honour it whether or not the
 * file exists. Otherwise we anchor to the canonical Syncthing location.
 */
export function resolvePulseDbPath(): string {
  if (_pulseCached) return _pulseCached;
  if (process.env.PULSE_DB_PATH) {
    _pulseCached = process.env.PULSE_DB_PATH;
    return _pulseCached;
  }
  const cwdSibling = path.join(process.cwd(), "..", "pulse.db");
  if (existsSync(cwdSibling)) {
    _pulseCached = cwdSibling;
    return cwdSibling;
  }
  _pulseCached = "./pulse/pulse.db";
  return _pulseCached;
}
