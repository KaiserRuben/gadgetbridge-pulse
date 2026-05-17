import "server-only";
import Database from "better-sqlite3";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const PULSE_DB_PATH =
  process.env.PULSE_DB_PATH ?? path.join(SYNC_ROOT, "pulse.db");

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
}

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(PULSE_DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = new Database(PULSE_DB_PATH);
  // Ensure table exists even if migrations haven't run (e.g. first-boot dashboard).
  _db.exec(`
    CREATE TABLE IF NOT EXISTS PULSE_PUSH_SUBSCRIPTION (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);
  return _db;
}

export function upsertSubscription(rec: Omit<PushSubscriptionRecord, "created_at" | "last_seen_at">): void {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO PULSE_PUSH_SUBSCRIPTION (endpoint, p256dh, auth, user_agent, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(rec.endpoint, rec.p256dh, rec.auth, rec.user_agent ?? null, now, now);
}

export function deleteSubscription(endpoint: string): void {
  db().prepare(`DELETE FROM PULSE_PUSH_SUBSCRIPTION WHERE endpoint = ?`).run(endpoint);
}

export function listSubscriptions(): PushSubscriptionRecord[] {
  return db()
    .prepare<[], PushSubscriptionRecord>(
      `SELECT endpoint, p256dh, auth, user_agent, created_at, last_seen_at
       FROM PULSE_PUSH_SUBSCRIPTION`,
    )
    .all();
}
