import Database from "better-sqlite3";
import { statSync } from "node:fs";
import { config } from "./config.ts";

let _db: Database.Database | null = null;
let _mtimeMs = 0;
let _ino = 0;

export function db(): Database.Database {
  const stat = statSync(config.dbPath);
  const rotated = !_db || stat.mtimeMs !== _mtimeMs || stat.ino !== _ino;
  if (rotated) {
    _db?.close();
    _db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
    _db.pragma("journal_mode = OFF");
    _db.pragma("query_only = ON");
    _mtimeMs = stat.mtimeMs;
    _ino = stat.ino;
  }
  return _db!;
}

export function dbStat() {
  const s = statSync(config.dbPath);
  return { mtimeMs: s.mtimeMs, ino: s.ino, size: s.size };
}
