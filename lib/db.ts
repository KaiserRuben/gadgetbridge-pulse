import "server-only";
import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Read-only SQLite handle with mtime-based hot reload.
 *
 * Syncthing replaces the DB by atomic rename. better-sqlite3 keeps the file
 * descriptor on the OLD inode → it keeps reading stale data forever. We
 * defeat that by stat()ing the path on every db() call. If the inode or
 * mtime changed, we close + reopen.
 *
 * stat() is a microsecond-cheap syscall. Doing it per-request is fine.
 */

let _db: Database.Database | null = null;
let _path: string | null = null;
let _mtimeMs = 0;
let _ino = 0;

const cacheBusters = new Set<() => void>();

/** Repositories register a cache invalidator here. Called when the DB rotates. */
export function registerCacheBuster(fn: () => void) {
  cacheBusters.add(fn);
  return () => cacheBusters.delete(fn);
}

function resolvePath(): string {
  if (_path) return _path;
  const candidates = [
    process.env.GADGETBRIDGE_DB_PATH,
    path.join(process.cwd(), "..", "Gadgetbridge.db"),
    "./pulse/Gadgetbridge.db",
  ].filter((p): p is string => Boolean(p));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Gadgetbridge.db not found. Set GADGETBRIDGE_DB_PATH. Tried:\n${candidates.join("\n")}`,
    );
  }
  _path = found;
  return found;
}

export function db(): Database.Database {
  const p = resolvePath();
  const stat = statSync(p);

  const rotated = !_db || stat.mtimeMs !== _mtimeMs || stat.ino !== _ino;

  if (rotated) {
    if (_db) {
      try {
        _db.close();
      } catch {
        /* swallow */
      }
      cacheBusters.forEach((fn) => {
        try {
          fn();
        } catch {
          /* swallow */
        }
      });
    }
    _db = new Database(p, { readonly: true, fileMustExist: true });
    _db.pragma("journal_mode = OFF");
    _db.pragma("query_only = ON");
    _mtimeMs = stat.mtimeMs;
    _ino = stat.ino;
  }

  return _db!;
}

export function dbStat() {
  const p = resolvePath();
  const s = statSync(p);
  return {
    path: p,
    sizeBytes: s.size,
    mtimeIso: new Date(s.mtimeMs).toISOString(),
    inode: s.ino,
  };
}
