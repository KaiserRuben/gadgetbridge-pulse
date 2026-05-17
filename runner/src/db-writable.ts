/**
 * Writable SQLite handle for the runner — opens `pulse.db`.
 *
 * The runner's read path on `db.ts` stays read-only against Gadgetbridge.db.
 * Writers (pattern library, smoke probe, future write-back features) use this
 * handle, which targets the Pulse-owned sidecar.
 *
 * Migrations run exactly once per process on first call. pulse.db is
 * auto-created if missing.
 */

import Database from "better-sqlite3";

import { config } from "./config.ts";
import { runMigrations } from "./db-migrations.ts";

let _writable: Database.Database | null = null;
let _migrated = false;

export function getWritableDb(): Database.Database {
  if (_writable) return _writable;
  // fileMustExist: false — pulse.db is OUR file, created on first open.
  const db = new Database(config.pulseDbPath, { readonly: false });
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  _writable = db;
  if (!_migrated) {
    runMigrations(db);
    _migrated = true;
  }
  return db;
}

export function closeWritableDb(): void {
  if (!_writable) return;
  try {
    _writable.close();
  } catch {
    /* swallow */
  }
  _writable = null;
  _migrated = false;
}
