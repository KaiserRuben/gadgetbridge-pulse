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
let _checkpointTimer: NodeJS.Timeout | null = null;

/**
 * How often Pi flushes its WAL into the main pulse.db file. Mac never
 * replicates the wal/shm files (they're in .stignore — single-writer
 * architecture, see project memory pulse-db-sync-corruption), so the Mac
 * runner only sees Pi writes once they reach the main file. 30 s is a sane
 * upper bound on read-staleness for runner reads of training plans /
 * settings; PASSIVE never blocks active readers or writers.
 */
const WAL_CHECKPOINT_INTERVAL_MS = 30_000;

/**
 * Host-role guard. Set `PULSE_ROLE=reader` on hosts that must NOT mutate
 * pulse.db (typically the Mac, which is supposed to POST to the Pi via
 * /api/ingest/*). Hosts authorised to write either set `PULSE_ROLE=writer`
 * or leave it unset (the legacy default is permissive so pi systemd
 * continues to work without env churn). See project memory
 * pulse-db-sync-corruption for the bug this prevents: meals classified
 * locally on the Mac never reach the Pi because each host has its own
 * .stignore'd pulse.db.
 */
function assertWritable(): void {
  const role = process.env.PULSE_ROLE?.trim().toLowerCase();
  if (role === "reader") {
    throw new Error(
      "pulse.db write denied: PULSE_ROLE=reader on this host. " +
        "Writes must go to the writer host via /api/ingest/*. " +
        "If this host is supposed to own pulse.db, set PULSE_ROLE=writer.",
    );
  }
}

export function getWritableDb(): Database.Database {
  assertWritable();
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
  if (!_checkpointTimer) {
    _checkpointTimer = setInterval(() => {
      try {
        _writable?.pragma("wal_checkpoint(PASSIVE)");
      } catch {
        /* swallow: a closed DB or transient busy is non-fatal here */
      }
    }, WAL_CHECKPOINT_INTERVAL_MS);
    // unref so the timer doesn't keep the Node event loop alive past
    // ordinary shutdown — Next.js handles graceful close itself.
    _checkpointTimer.unref?.();
  }
  return db;
}

export function closeWritableDb(): void {
  if (_checkpointTimer) {
    clearInterval(_checkpointTimer);
    _checkpointTimer = null;
  }
  if (!_writable) return;
  try {
    _writable.close();
  } catch {
    /* swallow */
  }
  _writable = null;
  _migrated = false;
}
