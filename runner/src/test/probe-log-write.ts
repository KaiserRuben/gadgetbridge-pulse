/**
 * Phase 4 smoke probe for the `/log/weight` write path.
 *
 * Mirrors what `lib/manual-log.ts#writeManualLog` does — same SQL, same
 * handle config — but reaches the DB through runner-side modules so we
 * can run as a plain `tsx` script. The lib helpers carry an
 * `import "server-only"` guard that throws under bare Node import; we
 * therefore inline the equivalent SQL here. The runtime behaviour and
 * row layout are identical.
 *
 * Run: `npx tsx runner/src/test/probe-log-write.ts`
 *
 * Re-running is safe: each invocation inserts another row with a fresh
 * timestamp. Migrations are idempotent.
 */

import { closeWritableDb, getWritableDb } from "../db-writable.ts";
import { runMigrations } from "../db-migrations.ts";

interface ManualLogRow {
  id: number;
  ts_iso: string;
  metric: string;
  value: number;
  unit: string;
  source: string;
  note: string | null;
}

function main(): void {
  const db = getWritableDb();
  runMigrations(db);

  const ts = new Date().toISOString();
  const note = `probe-log-write smoke ${ts}`;

  const insert = db.prepare<
    [string, string, number, string, string, string]
  >(
    `INSERT INTO PULSE_MANUAL_LOG (ts_iso, metric, value, unit, source, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const info = insert.run(ts, "weight_kg", 80, "kg", "test", note);
  const insertedId = Number(info.lastInsertRowid);
  console.log(`[probe-log-write] inserted id=${insertedId} ts=${ts}`);

  const recent = db
    .prepare<[string, number], ManualLogRow>(
      `SELECT id, ts_iso, metric, value, unit, source, note
       FROM PULSE_MANUAL_LOG
       WHERE metric = ?
       ORDER BY ts_iso DESC
       LIMIT ?`,
    )
    .all("weight_kg", 5);

  console.log(`[probe-log-write] read back ${recent.length} weight_kg rows:`);
  for (const r of recent) {
    console.log(
      `  id=${r.id} ts=${r.ts_iso} value=${r.value} ${r.unit} source=${r.source} note=${r.note ?? ""}`,
    );
  }

  const found = recent.find((r) => r.id === insertedId);
  if (!found) {
    throw new Error(`inserted row id=${insertedId} not found in readback`);
  }
  if (found.note !== note) {
    throw new Error(`note mismatch: wrote=${note} read=${found.note}`);
  }
  if (found.source !== "test") {
    throw new Error(`source mismatch: wrote=test read=${found.source}`);
  }
  if (found.value !== 80) {
    throw new Error(`value mismatch: wrote=80 read=${found.value}`);
  }

  closeWritableDb();
  console.log(`[probe-log-write] OK`);
}

main();
