/**
 * CLI: open the writable DB, run migrations, print status, close.
 *
 * Usage: `tsx runner/src/db-migrate.ts`
 *
 * Useful for manual triggering or pre-deploy sanity. No-op when up-to-date.
 */

import Database from "better-sqlite3";

import { config } from "./config.ts";
import { listMigrationIds, runMigrations } from "./db-migrations.ts";

function main(): void {
  // Open the Pulse-owned sidecar DB, NOT Gadgetbridge.db. Migrations live in
  // pulse.db so they survive Gadgetbridge re-exports from the phone.
  const db = new Database(config.pulseDbPath, { readonly: false, fileMustExist: false });
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  try {
    console.log(`[migrate] DB: ${config.pulseDbPath}`);
    const before = db
      .prepare<[], { id: string; applied_at: string }>(
        // PULSE_MIGRATIONS may not exist yet on a fresh install, so guard.
        `SELECT name FROM sqlite_master WHERE type='table' AND name='PULSE_MIGRATIONS'`,
      )
      .all();
    const haveTable = before.length > 0;
    console.log(`[migrate] PULSE_MIGRATIONS exists: ${haveTable}`);

    const result = runMigrations(db);
    console.log(`[migrate] applied this run: ${result.applied.length}`);
    for (const id of result.applied) console.log(`  + ${id}`);

    const all = db
      .prepare<[], { id: string; applied_at: string }>(
        `SELECT id, applied_at FROM PULSE_MIGRATIONS ORDER BY applied_at`,
      )
      .all();
    console.log(`[migrate] total recorded migrations: ${all.length}/${listMigrationIds().length}`);
    for (const r of all) console.log(`  ${r.id}\t${r.applied_at}`);
  } finally {
    db.close();
  }
}

main();
