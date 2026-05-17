import "server-only";
import Database from "better-sqlite3";

import { resolvePulseDbPath } from "./db-paths";
import { runMigrations } from "../runner/src/db-migrations.ts";

/**
 * Writable SQLite handle for the Next.js side — opens `pulse.db`.
 *
 * IMPORTANT: this is the Pulse-owned sidecar. Gadgetbridge.db is NEVER opened
 * writable; Android replaces it on every export and any edits would be lost.
 * All `PULSE_*` tables live here.
 *
 * Used ONLY from server actions and route handlers — never from RSC. The
 * read-only handle in `lib/db.ts` (Gadgetbridge.db) and `lib/pulse-db.ts`
 * (pulse.db) stay the default for any read path.
 *
 * WAL mode lets the readonly handles read concurrently; busy_timeout lets
 * us survive Syncthing's periodic file replacement (atomic rename) without
 * SQLITE_BUSY explosions.
 *
 * Migrations run exactly once per process on first call — pulse.db is
 * auto-created if missing, so the file does NOT need to exist beforehand.
 */

let _writable: Database.Database | null = null;
let _migrated = false;

export function getWritableDb(): Database.Database {
  if (_writable) return _writable;
  const dbPath = resolvePulseDbPath();
  // fileMustExist: false — pulse.db is OUR file. The very first open creates
  // it, then runMigrations() lays down every PULSE_* table.
  const db = new Database(dbPath, { readonly: false });
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
