import "server-only";

import { getWritableDb } from "../db-writable";
import { pulseDb } from "../pulse-db";
import type { NotifyTopic, RenderedPush, SuppressionReason } from "./types";

/**
 * PULSE_PUSH_LOG access.
 *
 * Every notify intent the Pi processes produces exactly one row:
 *   - result='sent'        — actually fanned out to web-push
 *   - result='suppressed'  — gated before send (dedup, quiet, budget, etc.)
 *
 * The log feeds three consumers:
 *   1. policy.ts — dedupe lookup (by dedupe_key over the last hour)
 *                  and budget enforcement (count of result='sent' in 24h)
 *   2. /settings/notifications — last-7d history table for transparency
 *   3. /api/notifications/click — engagement marker (future)
 */

export interface PushLogRow {
  id: number;
  sent_at: number;
  topic: NotifyTopic;
  title: string;
  body: string;
  url: string;
  dedupe_key: string;
  result: "sent" | "suppressed" | "failed";
  sent_count: number;
  pruned_count: number;
  failed_count: number;
  suppression_reason: SuppressionReason | null;
  payload_size: number | null;
}

export interface RecordedSend {
  rendered: RenderedPush;
  sent: number;
  pruned: number;
  failed: number;
  payloadSize: number;
}

export function recordSent(input: RecordedSend): number {
  const db = getWritableDb();
  const info = db
    .prepare(
      `INSERT INTO PULSE_PUSH_LOG
         (sent_at, topic, title, body, url, dedupe_key, result,
          sent_count, pruned_count, failed_count, suppression_reason, payload_size)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, NULL, ?)`,
    )
    .run(
      Date.now(),
      input.rendered.topic,
      input.rendered.title,
      input.rendered.body,
      input.rendered.url,
      input.rendered.dedupeKey,
      input.sent,
      input.pruned,
      input.failed,
      input.payloadSize,
    );
  return Number(info.lastInsertRowid);
}

export interface RecordedSuppression {
  topic: NotifyTopic;
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
  reason: SuppressionReason;
}

export function recordSuppression(input: RecordedSuppression): number {
  const db = getWritableDb();
  const info = db
    .prepare(
      `INSERT INTO PULSE_PUSH_LOG
         (sent_at, topic, title, body, url, dedupe_key, result,
          sent_count, pruned_count, failed_count, suppression_reason, payload_size)
       VALUES (?, ?, ?, ?, ?, ?, 'suppressed', 0, 0, 0, ?, NULL)`,
    )
    .run(
      Date.now(),
      input.topic,
      input.title,
      input.body,
      input.url,
      input.dedupeKey,
      input.reason,
    );
  return Number(info.lastInsertRowid);
}

/** Has a row with this dedupe_key been logged in the last `windowMs` ms? */
export function hasRecentDedupe(dedupeKey: string, windowMs: number): boolean {
  const db = pulseDb();
  if (!db) return false;
  const since = Date.now() - windowMs;
  const row = db
    .prepare<[string, number], { id: number }>(
      // Only sends count for dedupe — a previously *suppressed* attempt
      // (quiet hours, budget) should not block a later legitimate retry.
      `SELECT id FROM PULSE_PUSH_LOG
       WHERE dedupe_key = ? AND result = 'sent' AND sent_at >= ?
       LIMIT 1`,
    )
    .get(dedupeKey, since);
  return Boolean(row);
}

/** Count of result='sent' rows in the last `windowMs` ms. */
export function countSentSince(windowMs: number): number {
  const db = pulseDb();
  if (!db) return 0;
  const since = Date.now() - windowMs;
  const row = db
    .prepare<[number], { n: number }>(
      `SELECT COUNT(*) AS n FROM PULSE_PUSH_LOG
       WHERE result = 'sent' AND sent_at >= ?`,
    )
    .get(since);
  return row?.n ?? 0;
}

/** Last N rows for the history UI. */
export function listRecent(limit = 50): PushLogRow[] {
  const db = pulseDb();
  if (!db) return [];
  return db
    .prepare<[number], PushLogRow>(
      `SELECT id, sent_at, topic, title, body, url, dedupe_key, result,
              sent_count, pruned_count, failed_count, suppression_reason, payload_size
       FROM PULSE_PUSH_LOG
       ORDER BY sent_at DESC
       LIMIT ?`,
    )
    .all(limit);
}
