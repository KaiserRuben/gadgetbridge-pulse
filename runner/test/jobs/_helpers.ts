/**
 * Test helpers for jobs/* suites — wires a fresh in-memory pulse.db with
 * the full migration set so cell/queue/settings code paths run against a
 * realistic schema.
 */

import Database from "better-sqlite3";

import { runMigrations } from "../../src/db-migrations.ts";
import { setCellDb } from "../../src/jobs/cell.ts";
import { setSettingsDb, _resetSettingsForTests } from "../../src/jobs/settings.ts";
import { _resetQueueForTests } from "../../src/jobs/queue.ts";

export interface TestDbHandle {
  db: Database.Database;
  close: () => void;
}

export function makeTestDb(): TestDbHandle {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  setCellDb(db);
  setSettingsDb(db);
  return {
    db,
    close: () => {
      setCellDb(null);
      setSettingsDb(null);
      _resetSettingsForTests();
      _resetQueueForTests();
      try {
        db.close();
      } catch {
        /* swallow */
      }
    },
  };
}
