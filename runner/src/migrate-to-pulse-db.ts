/**
 * One-shot migration: pivot PULSE_* tables out of `Gadgetbridge.db` into
 * `pulse.db`.
 *
 * Why: Android Gadgetbridge replaces `Gadgetbridge.db` wholesale on every
 * export. Anything we colocate there gets wiped on the next Syncthing sync.
 *
 * Behaviour:
 *   1. Open Gadgetbridge.db (readonly) and pulse.db (writable, auto-create).
 *   2. For each PULSE_* table found in Gadgetbridge.db, copy schema (CREATE
 *      TABLE + indexes) to pulse.db if not already present.
 *   3. Copy all rows. Idempotent: existing rows in pulse.db are NOT
 *      duplicated. We use INSERT OR IGNORE keyed on the primary key.
 *   4. Verify per-table row counts match (target >= source — pulse.db may
 *      already have additional rows from prior partial runs or fresh
 *      writes).
 *   5. With `--commit`: re-open Gadgetbridge.db writable and DROP each
 *      PULSE_* table (and its indexes). Without `--commit`: dry-run only.
 *
 * Re-run safety:
 *   - After commit, Gadgetbridge.db has no PULSE_* tables. Re-running just
 *     prints a summary with zero work to do.
 *   - Before commit, re-running keeps copying any new rows that appeared in
 *     Gadgetbridge.db since the last run; INSERT OR IGNORE de-dupes.
 *
 * Usage:
 *   tsx runner/src/migrate-to-pulse-db.ts            # dry run, prints plan
 *   tsx runner/src/migrate-to-pulse-db.ts --commit   # actually drop sources
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";

import { config } from "./config.ts";
import { runMigrations } from "./db-migrations.ts";

interface SchemaRow {
  name: string;
  type: string;
  sql: string | null;
  tbl_name: string;
}

interface CountRow {
  c: number;
}

interface TableSummary {
  name: string;
  sourceCount: number;
  targetCountBefore: number;
  targetCountAfter: number;
  copied: number;
  dropped: boolean;
  error: string | null;
}

function listPulseTables(db: Database.Database): SchemaRow[] {
  // Filter by tbl_name so we pick up indexes whose own name doesn't start
  // with "PULSE_" (e.g. `idx_feel_ts` on PULSE_FEEL_LOG). We exclude
  // sqlite_autoindex_* — those are implicit and auto-recreated when we
  // CREATE TABLE on the target.
  return db
    .prepare<[], SchemaRow>(
      `SELECT name, type, sql, tbl_name
       FROM sqlite_master
       WHERE type IN ('table', 'index')
         AND tbl_name LIKE 'PULSE_%'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type DESC, name ASC`,
    )
    .all();
}

function countRows(db: Database.Database, table: string): number {
  // Validate identifier — only allow PULSE_* names. Defensive even though we
  // built the list from sqlite_master.
  if (!/^PULSE_[A-Z0-9_]+$/.test(table)) {
    throw new Error(`refusing unsafe identifier: ${table}`);
  }
  const row = db.prepare<[], CountRow>(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return row?.c ?? 0;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare<[string], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    )
    .get(name);
  return Boolean(row);
}

/**
 * Build a deterministic primary-key sort to make INSERT OR IGNORE work.
 * Each PULSE_* table has either:
 *   - INTEGER PRIMARY KEY AUTOINCREMENT id (manual_log, journal, feel,
 *     user_attributes)
 *   - TEXT PRIMARY KEY id (pattern_library, migrations)
 * In both cases, the column is named `id`. We rely on that.
 */
function copyRows(
  source: Database.Database,
  target: Database.Database,
  table: string,
): { copied: number } {
  if (!/^PULSE_[A-Z0-9_]+$/.test(table)) {
    throw new Error(`refusing unsafe identifier: ${table}`);
  }
  // Pull column list from target so we can build a parameterised INSERT.
  const cols = target
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name);
  if (cols.length === 0) {
    throw new Error(`target table ${table} has no columns — schema not created?`);
  }
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map(() => "?").join(", ");

  const select = source.prepare<[], Record<string, unknown>>(
    `SELECT ${colList} FROM ${table}`,
  );
  const insert = target.prepare(
    `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`,
  );

  let copied = 0;
  const tx = target.transaction(() => {
    for (const row of select.iterate()) {
      const values = cols.map((c) => row[c] ?? null);
      const info = insert.run(...values);
      if (info.changes > 0) copied += 1;
    }
  });
  tx();
  return { copied };
}

function applySchemaToTarget(
  target: Database.Database,
  schemaRows: readonly SchemaRow[],
): void {
  // Tables first (we filtered with `ORDER BY type DESC` so 'table' < 'index'
  // alphabetically — actually 'table' > 'index', so DESC orders tables first.
  // Re-sort defensively.
  const tables = schemaRows.filter((r) => r.type === "table");
  const indexes = schemaRows.filter((r) => r.type === "index");

  const tx = target.transaction(() => {
    for (const t of tables) {
      if (!t.sql) continue;
      // Use `IF NOT EXISTS` if the source DDL omitted it.
      const sql = t.sql.replace(
        /^CREATE TABLE\s+(?!IF NOT EXISTS)/i,
        "CREATE TABLE IF NOT EXISTS ",
      );
      target.exec(sql);
    }
    for (const i of indexes) {
      if (!i.sql) continue;
      const sql = i.sql.replace(
        /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/i,
        (m) => m + "IF NOT EXISTS ",
      );
      target.exec(sql);
    }
  });
  tx();
}

function dropFromSource(
  source: Database.Database,
  schemaRows: readonly SchemaRow[],
): void {
  const tables = schemaRows.filter((r) => r.type === "table");
  const indexes = schemaRows.filter((r) => r.type === "index");

  const tx = source.transaction(() => {
    // Indexes first to keep the catalogue tidy (DROP TABLE removes them too,
    // but explicit is cheaper than scanning sqlite_master afterwards).
    for (const i of indexes) {
      source.exec(`DROP INDEX IF EXISTS "${i.name}"`);
    }
    for (const t of tables) {
      source.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    }
  });
  tx();
}

function main(): void {
  const commit = process.argv.includes("--commit");
  const sourcePath = config.dbPath;
  const targetPath = config.pulseDbPath;

  console.log(`[migrate] source: ${sourcePath}`);
  console.log(`[migrate] target: ${targetPath}`);
  console.log(`[migrate] mode:   ${commit ? "COMMIT (will drop source)" : "DRY-RUN"}`);
  console.log("");

  if (!existsSync(sourcePath)) {
    throw new Error(`source not found: ${sourcePath}`);
  }

  // Open source readonly; we'll re-open writable later if --commit.
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  source.pragma("query_only = ON");

  const schemaRows = listPulseTables(source);
  if (schemaRows.length === 0) {
    console.log("[migrate] no PULSE_* tables in source — nothing to do.");
    source.close();
    return;
  }
  const tableNames = schemaRows
    .filter((r) => r.type === "table")
    .map((r) => r.name);
  const indexNames = schemaRows
    .filter((r) => r.type === "index")
    .map((r) => r.name);
  console.log(`[migrate] found ${tableNames.length} tables, ${indexNames.length} indexes:`);
  for (const t of tableNames) console.log(`  table  ${t}`);
  for (const i of indexNames) console.log(`  index  ${i}`);
  console.log("");

  // Open target writable; auto-create if missing. Run our migrations FIRST so
  // M005 etc. exist there in case the source is missing some tables.
  const target = new Database(targetPath, { readonly: false });
  target.pragma("journal_mode = WAL");
  target.pragma("busy_timeout = 5000");
  target.pragma("foreign_keys = ON");
  runMigrations(target);

  // Apply any schema rows from the source that are not already present
  // (covers tables the runtime migrations don't define — should be a no-op
  // for the standard set, but keeps the script honest).
  applySchemaToTarget(target, schemaRows);

  const summary: TableSummary[] = [];

  for (const t of tableNames) {
    const sourceCount = countRows(source, t);
    const targetCountBefore = tableExists(target, t) ? countRows(target, t) : 0;
    let copied = 0;
    let error: string | null = null;
    try {
      const r = copyRows(source, target, t);
      copied = r.copied;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const targetCountAfter = tableExists(target, t) ? countRows(target, t) : 0;
    summary.push({
      name: t,
      sourceCount,
      targetCountBefore,
      targetCountAfter,
      copied,
      dropped: false,
      error,
    });
  }

  // Verify: every source row landed (target >= source).
  let okToCommit = true;
  for (const s of summary) {
    if (s.error) {
      okToCommit = false;
      console.error(`[migrate] ${s.name}: ERROR ${s.error}`);
    }
    if (s.targetCountAfter < s.sourceCount) {
      okToCommit = false;
      console.error(
        `[migrate] ${s.name}: target (${s.targetCountAfter}) < source (${s.sourceCount}) — refusing to drop`,
      );
    }
  }

  // Drop step (only with --commit AND verification passed).
  if (commit && okToCommit) {
    source.close();
    const sourceWritable = new Database(sourcePath, {
      readonly: false,
      fileMustExist: true,
    });
    sourceWritable.pragma("journal_mode = WAL");
    sourceWritable.pragma("busy_timeout = 5000");
    try {
      dropFromSource(sourceWritable, schemaRows);
      for (const s of summary) s.dropped = true;
    } finally {
      sourceWritable.close();
    }
  } else {
    source.close();
  }

  target.close();

  // Summary table.
  console.log("");
  console.log("[migrate] summary:");
  console.log(
    `  ${"table".padEnd(28)} ${"src".padStart(6)} ${"tgt(b)".padStart(8)} ${"tgt(a)".padStart(8)} ${"copied".padStart(7)} dropped`,
  );
  for (const s of summary) {
    console.log(
      `  ${s.name.padEnd(28)} ${String(s.sourceCount).padStart(6)} ${String(s.targetCountBefore).padStart(8)} ${String(s.targetCountAfter).padStart(8)} ${String(s.copied).padStart(7)} ${s.dropped ? "yes" : "no"}${s.error ? `  ERROR: ${s.error}` : ""}`,
    );
  }
  console.log("");

  if (!commit) {
    console.log(
      `[migrate] DRY-RUN done. ${okToCommit ? "Verification passed." : "Verification FAILED — see errors above."} ` +
        `Re-run with --commit to drop source tables.`,
    );
  } else if (okToCommit) {
    console.log(`[migrate] COMMIT done. PULSE_* tables removed from source.`);
  } else {
    console.log(`[migrate] COMMIT aborted: verification failed. Source tables left intact.`);
    process.exitCode = 1;
  }
}

main();
