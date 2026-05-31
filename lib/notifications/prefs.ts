import "server-only";

import { getWritableDb } from "../db-writable";
import { pulseDb } from "../pulse-db";
import type { NotifyTopic } from "./types";

/**
 * Push preferences live in PULSE_PUSH_PREFS (key/value JSON). This module
 * presents a typed view with sensible defaults, so callers never deal with
 * raw rows or missing-key handling.
 *
 * Defaults express the design contract: every topic ON except coach_quote
 * (off by default — quotes are opt-in to avoid feeling cheap). Budget is
 * 4 pushes/day (median 2 expected). Quiet hours are off by default and
 * inferred from data when not user-overridden (policy.ts does the math).
 */

export interface PushPrefs {
  /** Per-topic toggles. Missing key = default ON, except coach_quote OFF. */
  topics: Record<NotifyTopic, boolean>;
  /** Max successful sends per rolling 24h. */
  budgetPerDay: number;
  /** Manual quiet-hours override (24h "HH:MM"). null = infer from data. */
  quietStart: string | null;
  quietEnd: string | null;
  /** Master kill switch — when false, every topic is suppressed. */
  enabled: boolean;
}

const DEFAULTS: PushPrefs = {
  topics: {
    meal_classified: true,
    day_finalized: true,
    sleep_complete: true,
    workout_complete: true,
    pattern_detected: true,
    safety_anomaly: true,
    coach_quote: false,
    test: true,
  },
  budgetPerDay: 4,
  quietStart: null,
  quietEnd: null,
  enabled: true,
};

function read<T>(key: string): T | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], { value_json: string }>(
        `SELECT value_json FROM PULSE_PUSH_PREFS WHERE key = ?`,
      )
      .get(key);
    return row ? (JSON.parse(row.value_json) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  const db = getWritableDb();
  db.prepare(
    `INSERT INTO PULSE_PUSH_PREFS (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

/** Read the full prefs view, falling back to defaults per key. */
export function readPushPrefs(): PushPrefs {
  const topics = { ...DEFAULTS.topics };
  for (const topic of Object.keys(DEFAULTS.topics) as NotifyTopic[]) {
    const v = read<boolean>(`topic:${topic}`);
    if (typeof v === "boolean") topics[topic] = v;
  }
  return {
    topics,
    budgetPerDay: read<number>("budget_per_day") ?? DEFAULTS.budgetPerDay,
    quietStart: read<string>("quiet_start"),
    quietEnd: read<string>("quiet_end"),
    enabled: read<boolean>("enabled") ?? DEFAULTS.enabled,
  };
}

export function setTopicEnabled(topic: NotifyTopic, enabled: boolean): void {
  write(`topic:${topic}`, enabled);
}

export function setBudgetPerDay(n: number): void {
  if (!Number.isFinite(n) || n < 0 || n > 64) {
    throw new Error(`invalid budget: ${n}`);
  }
  write("budget_per_day", Math.floor(n));
}

export function setQuietHours(start: string | null, end: string | null): void {
  // Accept "HH:MM" or null. Range validation kept minimal — the policy gate
  // tolerates malformed values by ignoring them.
  if (start !== null && !/^\d{2}:\d{2}$/.test(start)) {
    throw new Error(`invalid quiet_start: ${start}`);
  }
  if (end !== null && !/^\d{2}:\d{2}$/.test(end)) {
    throw new Error(`invalid quiet_end: ${end}`);
  }
  write("quiet_start", start);
  write("quiet_end", end);
}

export function setEnabled(enabled: boolean): void {
  write("enabled", enabled);
}

export function defaultsForTopic(topic: NotifyTopic): boolean {
  return DEFAULTS.topics[topic];
}
