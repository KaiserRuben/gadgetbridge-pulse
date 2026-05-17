/**
 * Read-only handle on `pulse.db` for the runner.
 *
 * Same hot-reload pattern as `db.ts` but targets the Pulse-owned sidecar.
 * Returns `null` when the file does not yet exist — readers that depend on
 * specific tables should fall through gracefully (return [] / no-op) in that
 * case.
 */

import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";

import { config } from "./config.ts";

let _db: Database.Database | null = null;
let _mtimeMs = 0;
let _ino = 0;

export function pulseDb(): Database.Database | null {
  if (!existsSync(config.pulseDbPath)) return null;
  const stat = statSync(config.pulseDbPath);
  const rotated = !_db || stat.mtimeMs !== _mtimeMs || stat.ino !== _ino;
  if (rotated) {
    _db?.close();
    _db = new Database(config.pulseDbPath, { readonly: true, fileMustExist: true });
    _db.pragma("journal_mode = OFF");
    _db.pragma("query_only = ON");
    _mtimeMs = stat.mtimeMs;
    _ino = stat.ino;
  }
  return _db;
}

export function pulseDbOrThrow(): Database.Database {
  const conn = pulseDb();
  if (!conn) {
    throw new Error(
      `pulse.db not found at ${config.pulseDbPath}. Run the migration once or call getWritableDb().`,
    );
  }
  return conn;
}

export function pulseDbStat() {
  if (!existsSync(config.pulseDbPath)) return null;
  const s = statSync(config.pulseDbPath);
  return { mtimeMs: s.mtimeMs, ino: s.ino, size: s.size };
}
