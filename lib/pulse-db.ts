import "server-only";
import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";

import { resolvePulseDbPath } from "./db-paths";

/**
 * Read-only SQLite handle on `pulse.db` (the Pulse-owned sidecar).
 *
 * Mirrors the mtime-based hot reload of `lib/db.ts`, but pulse.db is much
 * less likely to be replaced wholesale (Pulse owns the file). The reload is
 * still useful: it covers the migration script's atomic file replacement and
 * any future bidirectional Syncthing scenarios.
 *
 * If pulse.db does not yet exist, callers get back a connection to an empty
 * (just-created) read-only database — better-sqlite3 in readonly mode
 * requires the file to exist, so we let the writable side bootstrap first
 * and otherwise return `null` from `pulseDb()`. Readers that depend on
 * specific tables wrap their queries in a try/catch (see `lib/queries/patterns.ts`
 * pattern) so a missing file degrades gracefully to "no data yet".
 */

let _db: Database.Database | null = null;
let _path: string | null = null;
let _mtimeMs = 0;
let _ino = 0;

const cacheBusters = new Set<() => void>();

export function registerPulseCacheBuster(fn: () => void) {
  cacheBusters.add(fn);
  return () => cacheBusters.delete(fn);
}

/**
 * Open (or reuse) the read-only handle on pulse.db. Returns `null` when the
 * file does not exist — callers should treat that as "no Pulse data yet" and
 * fall through.
 */
export function pulseDb(): Database.Database | null {
  const p = resolvePulseDbPath();
  if (!existsSync(p)) return null;

  const stat = statSync(p);
  const rotated = !_db || _path !== p || stat.mtimeMs !== _mtimeMs || stat.ino !== _ino;

  if (rotated) {
    if (_db) {
      try {
        _db.close();
      } catch {
        /* swallow */
      }
      cacheBusters.forEach((fn) => {
        try {
          fn();
        } catch {
          /* swallow */
        }
      });
    }
    // Open read-write (not readonly) with `query_only = ON`. WAL-mode databases
    // route reads through the WAL file, but better-sqlite3's `readonly: true`
    // opens a separate connection that cannot see uncommitted WAL frames until
    // the next checkpoint. The result is that a meal INSERT from the writable
    // handle stays invisible to the read handle until SQLite checkpoints —
    // which can take minutes. RW + `query_only = ON` gives identical safety
    // (writes are rejected at the SQL layer) and consistent reads.
    _db = new Database(p, { readonly: false, fileMustExist: true });
    _db.pragma("query_only = ON");
    _db.pragma("busy_timeout = 5000");
    _path = p;
    _mtimeMs = stat.mtimeMs;
    _ino = stat.ino;
  }
  return _db;
}

/**
 * Like `pulseDb()` but throws when the file is missing. Use from code paths
 * that have already verified pulse.db exists (typically right after a
 * writable initialisation).
 */
export function pulseDbOrThrow(): Database.Database {
  const conn = pulseDb();
  if (!conn) {
    throw new Error(
      `pulse.db not found at ${resolvePulseDbPath()}. ` +
        `Run the migration once or call getWritableDb() to bootstrap.`,
    );
  }
  return conn;
}
