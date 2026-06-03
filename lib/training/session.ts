import "server-only";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";
import type { ActualSessionV1 } from "../types/generated";
import { readActivePlan } from "./plan";
import { loadCandidatesAround } from "./wearable-candidates";
import { evaluateStitch } from "./wearable-stitch";

/**
 * Actual-session lifecycle helpers. Pi-side writes.
 *
 * State machine:
 *   create()                → in_progress
 *   finish()                → completed | abandoned
 *   updateMeta()            → patch note / subjective_energy / wearable link
 *   linkWearable()          → tentative / confirmed / manual
 *
 * Idempotency: callers mint the UUID client-side and reuse it on retries —
 * INSERT OR IGNORE keeps re-sends safe under a flaky gym connection.
 */

export interface SessionRow {
  id: string;
  period_key: string;
  plan_version: number;
  planned_session_id: number | null;
  session_template_id: string | null;
  deviation_reason: ActualSessionV1["deviation_reason"];
  state: ActualSessionV1["state"];
  started_at: string;
  completed_at: string | null;
  subjective_energy: number | null;
  note: string | null;
  wearable_workout_id: number | null;
  wearable_link_status: ActualSessionV1["wearable_link_status"];
  wearable_link_resolved_at: string | null;
  last_edited_at: string | null;
}

interface SessionRawRow extends Omit<SessionRow, "deviation_reason" | "state" | "wearable_link_status"> {
  deviation_reason: string | null;
  state: string;
  wearable_link_status: string;
}

const SELECT_COLUMNS = `
  id, period_key, plan_version, planned_session_id, session_template_id,
  deviation_reason, state, started_at, completed_at, subjective_energy, note,
  wearable_workout_id, wearable_link_status, wearable_link_resolved_at, last_edited_at
`;

function rowToSession(r: SessionRawRow): SessionRow {
  return {
    ...r,
    deviation_reason: (r.deviation_reason as ActualSessionV1["deviation_reason"]) ?? null,
    state: r.state as ActualSessionV1["state"],
    wearable_link_status: r.wearable_link_status as ActualSessionV1["wearable_link_status"],
  };
}

export function readSession(id: string): SessionRow | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], SessionRawRow>(
        `SELECT ${SELECT_COLUMNS} FROM PULSE_ACTUAL_SESSION WHERE id = ?`,
      )
      .get(id);
    return row ? rowToSession(row) : null;
  } catch {
    return null;
  }
}

export interface ListSessionsOpts {
  period_key?: string;
  state?: ActualSessionV1["state"];
  since_iso?: string;
  limit?: number;
}

export function listSessions(opts: ListSessionsOpts = {}): SessionRow[] {
  const db = pulseDb();
  if (!db) return [];
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.period_key) {
    where.push("period_key = ?");
    params.push(opts.period_key);
  }
  if (opts.state) {
    where.push("state = ?");
    params.push(opts.state);
  }
  if (opts.since_iso) {
    where.push("started_at >= ?");
    params.push(opts.since_iso);
  }
  const limit = opts.limit ?? 100;
  try {
    const sql = `SELECT ${SELECT_COLUMNS}
                 FROM PULSE_ACTUAL_SESSION
                 ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY started_at DESC
                 LIMIT ${limit}`;
    const rows = db.prepare<(string | number)[], SessionRawRow>(sql).all(...params);
    return rows.map(rowToSession);
  } catch {
    return [];
  }
}

export interface CreateSessionInput {
  id: string;
  period_key: string;
  plan_version?: number;
  session_template_id: string | null;
  planned_session_id?: number | null;
  deviation_reason?: ActualSessionV1["deviation_reason"];
  started_at?: string;
}

/**
 * Insert a new in-progress session. Re-running with the same UUID returns
 * the existing row instead of erroring, so a retried POST from a flaky
 * client is a no-op rather than a duplicate.
 */
export function createSession(input: CreateSessionInput): SessionRow {
  const existing = readSession(input.id);
  if (existing) return existing;

  const db = getWritableDb();
  // Plan version defaults to whatever is active right now. Writing it onto
  // the session row freezes the version so a mid-week plan bump does not
  // silently change what "today's session" means.
  let planVersion = input.plan_version;
  if (planVersion == null) {
    const active = readActivePlan();
    if (!active) {
      throw new Error("no active plan — run /api/training/plan/import first");
    }
    planVersion = active.version;
  }
  const startedAt = input.started_at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO PULSE_ACTUAL_SESSION
       (id, period_key, plan_version, planned_session_id, session_template_id,
        deviation_reason, state, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)`,
  ).run(
    input.id,
    input.period_key,
    planVersion,
    input.planned_session_id ?? null,
    input.session_template_id,
    input.deviation_reason ?? null,
    startedAt,
  );
  const row = readSession(input.id);
  if (!row) throw new Error("session insert vanished");
  return row;
}

export interface FinishSessionInput {
  id: string;
  state: "completed" | "abandoned";
  subjective_energy?: number | null;
  note?: string | null;
  completed_at?: string;
}

export function finishSession(input: FinishSessionInput): SessionRow {
  const db = getWritableDb();
  const completedAt = input.completed_at ?? new Date().toISOString();
  const info = db
    .prepare(
      `UPDATE PULSE_ACTUAL_SESSION
       SET state = ?, completed_at = ?,
           subjective_energy = COALESCE(?, subjective_energy),
           note = COALESCE(?, note)
       WHERE id = ? AND state = 'in_progress'`,
    )
    .run(
      input.state,
      completedAt,
      input.subjective_energy ?? null,
      input.note ?? null,
      input.id,
    );
  if (info.changes === 0) {
    const existing = readSession(input.id);
    if (existing) return existing; // already finished; idempotent.
    throw new Error(`session ${input.id} not found`);
  }
  const row = readSession(input.id);
  if (!row) throw new Error("session vanished after finish");

  // Auto-stitch only when state=completed AND no manual link exists yet.
  // Skip on `abandoned` (we don't link discarded sessions to wearable
  // workouts that happened to overlap).
  if (
    row.state === "completed" &&
    row.wearable_link_status === "none" &&
    row.completed_at
  ) {
    try {
      const candidates = loadCandidatesAround(row.started_at, row.completed_at);
      const outcome = evaluateStitch({
        session: {
          started_at: row.started_at,
          completed_at: row.completed_at,
          period_key: row.period_key,
        },
        candidates,
      });
      if (outcome.pick && outcome.reason === "auto_linked") {
        return linkWearable({
          id: row.id,
          wearable_workout_id: outcome.pick.id,
          status: outcome.status === "confirmed" ? "confirmed" : "tentative",
        });
      }
    } catch {
      // Auto-stitch is best-effort. Falling through preserves the finished
      // session with link_status='none'; the user can manually link later.
    }
  }
  return row;
}

export interface UpdateSessionMetaInput {
  id: string;
  subjective_energy?: number | null;
  note?: string | null;
}

export function updateSessionMeta(input: UpdateSessionMetaInput): SessionRow {
  const db = getWritableDb();
  db.prepare(
    `UPDATE PULSE_ACTUAL_SESSION
     SET subjective_energy = COALESCE(?, subjective_energy),
         note = COALESCE(?, note),
         last_edited_at = ?
     WHERE id = ?`,
  ).run(
    input.subjective_energy ?? null,
    input.note ?? null,
    new Date().toISOString(),
    input.id,
  );
  const row = readSession(input.id);
  if (!row) throw new Error(`session ${input.id} not found`);
  return row;
}

/**
 * Auto-close sessions left in `in_progress` past `maxAgeMs` — a user starts
 * a session, never opens the app again, and the row sticks forever. Treated
 * as `abandoned` with completed_at = started_at + maxAgeMs so it stops
 * blocking "in_progress" UI affordances on the training page. Pi-only write.
 * Returns the number of rows swept.
 */
export function sweepStaleSessions(maxAgeMs: number): number {
  const db = getWritableDb();
  const r = db
    .prepare(
      `UPDATE PULSE_ACTUAL_SESSION
          SET state = 'abandoned',
              completed_at = strftime('%Y-%m-%dT%H:%M:%fZ',
                                      julianday(started_at) + (? / 86400000.0)),
              last_edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE state = 'in_progress'
          AND (strftime('%s', 'now') - strftime('%s', started_at)) * 1000 > ?`,
    )
    .run(maxAgeMs, maxAgeMs);
  return r.changes;
}

export interface LinkWearableInput {
  id: string;
  wearable_workout_id: number | null;
  status: ActualSessionV1["wearable_link_status"];
}

export function linkWearable(input: LinkWearableInput): SessionRow {
  const db = getWritableDb();
  db.prepare(
    `UPDATE PULSE_ACTUAL_SESSION
     SET wearable_workout_id = ?,
         wearable_link_status = ?,
         wearable_link_resolved_at = ?
     WHERE id = ?`,
  ).run(
    input.wearable_workout_id,
    input.status,
    new Date().toISOString(),
    input.id,
  );
  const row = readSession(input.id);
  if (!row) throw new Error(`session ${input.id} not found`);
  return row;
}
