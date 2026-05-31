import "server-only";

import { getWritableDb } from "../db-writable";
import { pulseDb } from "../pulse-db";

/**
 * Consent state machine for the soft-then-OS-prompt ladder.
 *
 *   ASK_NEVER       (default; show nothing on home)
 *   ELIGIBLE_SOFT   (engagement gate passed; show consent card)
 *   SOFT_ACCEPTED   (user tapped "Erlauben"; show OS prompt next visit)
 *   ACTIVE          (browser permission + subscription stored)
 *   SOFT_DECLINED   (user tapped "Später"; re-show after backoff)
 *   REVOKED         (user disabled in settings or OS; never re-prompt)
 *
 * State lives in PULSE_PUSH_PREFS under key `consent_state` so the dashboard
 * can SSR the home page with the correct card visibility (no client flash).
 *
 * The "engagement gate" is the runtime check that bumps a user from
 * ASK_NEVER → ELIGIBLE_SOFT: at least one meal logged AND at least one
 * finalized day viewed. That bookkeeping lives client-side (localStorage)
 * + server-side (meal count from PULSE_MEAL); see lib/notifications/eligible.ts
 * if we end up adding more elaborate gating.
 */

export type ConsentState =
  | "ASK_NEVER"
  | "ELIGIBLE_SOFT"
  | "SOFT_ACCEPTED"
  | "ACTIVE"
  | "SOFT_DECLINED"
  | "REVOKED";

const KEY = "consent_state";
const DECLINED_AT_KEY = "consent_declined_at";
const SOFT_DECLINE_BACKOFF_DAYS = 7;

export function readConsentState(): ConsentState {
  const db = pulseDb();
  if (!db) return "ASK_NEVER";
  try {
    const row = db
      .prepare<[string], { value_json: string }>(
        `SELECT value_json FROM PULSE_PUSH_PREFS WHERE key = ?`,
      )
      .get(KEY);
    if (!row) return "ASK_NEVER";
    const v = JSON.parse(row.value_json);
    return typeof v === "string" ? (v as ConsentState) : "ASK_NEVER";
  } catch {
    return "ASK_NEVER";
  }
}

function writeKey(key: string, value: unknown): void {
  const db = getWritableDb();
  db.prepare(
    `INSERT INTO PULSE_PUSH_PREFS (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function setConsentState(state: ConsentState): void {
  writeKey(KEY, state);
  if (state === "SOFT_DECLINED") {
    writeKey(DECLINED_AT_KEY, Date.now());
  }
}

/** Returns true when the soft card should be shown on the home page. */
export function shouldShowSoftCard(state: ConsentState): boolean {
  if (state === "ELIGIBLE_SOFT") return true;
  if (state === "SOFT_DECLINED") {
    const db = pulseDb();
    if (!db) return false;
    const row = db
      .prepare<[string], { value_json: string }>(
        `SELECT value_json FROM PULSE_PUSH_PREFS WHERE key = ?`,
      )
      .get(DECLINED_AT_KEY);
    if (!row) return true;
    const declinedAt = Number(JSON.parse(row.value_json));
    const ageDays = (Date.now() - declinedAt) / (24 * 60 * 60 * 1000);
    return ageDays >= SOFT_DECLINE_BACKOFF_DAYS;
  }
  return false;
}

/**
 * Promote ASK_NEVER → ELIGIBLE_SOFT when the engagement criteria are met.
 * Idempotent: only the ASK_NEVER → ELIGIBLE_SOFT transition is allowed
 * here; everything else is left untouched (so a REVOKED user stays REVOKED
 * even if they later log another meal).
 */
export function maybePromoteToEligible(criteriaMet: boolean): ConsentState {
  const current = readConsentState();
  if (current === "ASK_NEVER" && criteriaMet) {
    setConsentState("ELIGIBLE_SOFT");
    return "ELIGIBLE_SOFT";
  }
  return current;
}
