/**
 * Smoke probe for Phase 4 write-back.
 *
 *   1. Run migrations (idempotent).
 *   2. Insert one row into each PULSE_* table.
 *   3. Read each back; print row counts.
 *   4. Verify Gadgetbridge tables (USER, HUAWEI_ACTIVITY_SAMPLE) are still
 *      readable in the same process.
 *   5. Close cleanly. Exit 0.
 *
 * Run: `tsx runner/src/test/probe-db-write.ts`
 *
 * Re-running is safe: each run inserts another row, so the count grows.
 * Migrations are idempotent.
 */

import { closeWritableDb, getWritableDb } from "../db-writable.ts";
import { runMigrations } from "../db-migrations.ts";
import { upsertPattern, readPatterns } from "../analyzer/pattern-library.ts";
import { db as gbDb } from "../db.ts";

interface CountRow {
  c: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  // 1. Migrations
  const db = getWritableDb();
  const result = runMigrations(db);
  console.log(`[probe] migrations applied this run: ${result.applied.length}`);
  for (const id of result.applied) console.log(`  + ${id}`);

  // 2. Insert into each table.
  const ts = nowIso();

  const manualInfo = db
    .prepare<[string, string, number, string, string, string]>(
      `INSERT INTO PULSE_MANUAL_LOG (ts_iso, metric, value, unit, source, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ts, "weight_kg", 78.4, "kg", "probe", "probe-db-write smoke");
  console.log(`[probe] PULSE_MANUAL_LOG inserted id=${manualInfo.lastInsertRowid}`);

  const journalInfo = db
    .prepare<[string, string, number, string, string]>(
      `INSERT INTO PULSE_JOURNAL_ENTRY (ts_iso, text, mood, tags, source)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ts, "smoke probe entry", 4, JSON.stringify(["probe", "smoke"]), "probe");
  console.log(`[probe] PULSE_JOURNAL_ENTRY inserted id=${journalInfo.lastInsertRowid}`);

  const feelInfo = db
    .prepare<[string, number, string, string]>(
      `INSERT INTO PULSE_FEEL_LOG (ts_iso, feel, note, source)
       VALUES (?, ?, ?, ?)`,
    )
    .run(ts, 3, "probe", "user_input");
  console.log(`[probe] PULSE_FEEL_LOG inserted id=${feelInfo.lastInsertRowid}`);

  const patternId = `probe-pattern-fixed-id`;
  const upserted = upsertPattern({
    id: patternId,
    name_de: "Probe-Muster",
    description_de: "Synthetisches Muster für den Smoke-Test.",
    signature_json: JSON.stringify({ kind: "probe", features: [1, 2, 3] }),
    first_seen: todayDate(),
    last_seen: todayDate(),
  });
  console.log(
    `[probe] PULSE_PATTERN_LIBRARY upserted id=${upserted.id} occ=${upserted.occurrence_count}`,
  );

  // 3. Read back / counts.
  const counts = {
    PULSE_MANUAL_LOG: db
      .prepare<[], CountRow>(`SELECT COUNT(*) AS c FROM PULSE_MANUAL_LOG`)
      .get()?.c ?? 0,
    PULSE_JOURNAL_ENTRY: db
      .prepare<[], CountRow>(`SELECT COUNT(*) AS c FROM PULSE_JOURNAL_ENTRY`)
      .get()?.c ?? 0,
    PULSE_FEEL_LOG: db
      .prepare<[], CountRow>(`SELECT COUNT(*) AS c FROM PULSE_FEEL_LOG`)
      .get()?.c ?? 0,
    PULSE_PATTERN_LIBRARY: db
      .prepare<[], CountRow>(`SELECT COUNT(*) AS c FROM PULSE_PATTERN_LIBRARY`)
      .get()?.c ?? 0,
    PULSE_MIGRATIONS: db
      .prepare<[], CountRow>(`SELECT COUNT(*) AS c FROM PULSE_MIGRATIONS`)
      .get()?.c ?? 0,
  };
  console.log(`[probe] counts:`);
  for (const [t, c] of Object.entries(counts)) console.log(`  ${t}: ${c}`);

  const patterns = readPatterns(5);
  console.log(`[probe] readPatterns(5) -> ${patterns.length} rows`);

  // 4. Gadgetbridge tables still readable via the readonly handle?
  // Pulse.db (writable) has only PULSE_* now; sensor data lives in Gadgetbridge.db.
  const gb = gbDb();
  const userRow = gb
    .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM USER`)
    .get();
  console.log(`[probe] USER rows: ${userRow?.c ?? 0}`);

  const haSampleRow = gb
    .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM HUAWEI_ACTIVITY_SAMPLE`)
    .get();
  console.log(`[probe] HUAWEI_ACTIVITY_SAMPLE rows: ${haSampleRow?.c ?? 0}`);

  // Sanity assertions — non-zero migration count, at least 1 of each PULSE_* row.
  if (counts.PULSE_MIGRATIONS < 4) {
    throw new Error(`expected >=4 migrations recorded, got ${counts.PULSE_MIGRATIONS}`);
  }
  for (const [table, c] of Object.entries(counts)) {
    if (table === "PULSE_MIGRATIONS") continue;
    if (c < 1) throw new Error(`expected >=1 row in ${table}, got ${c}`);
  }
  if ((userRow?.c ?? 0) < 1) {
    throw new Error("Gadgetbridge USER table unreadable or empty");
  }

  // 5. Close.
  closeWritableDb();
  console.log(`[probe] OK`);
}

main();
