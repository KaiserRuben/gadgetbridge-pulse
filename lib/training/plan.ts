import "server-only";
import { createHash } from "node:crypto";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";
import type { TrainingPlanV1 } from "../types/generated";

/**
 * Pulse-owned training plan storage.
 *
 * Plan documents are written to PULSE_TRAINING_PLAN with full payloads in
 * `payload_json`. Only one row is `is_active=1` at any time; the partial
 * unique index in M008 enforces this. Older versions stay queryable so
 * the UI + LLM context can render history.
 *
 * The plan document shape is governed by `runner/src/schemas/training/training-plan.schema.json`
 * (generated type `TrainingPlanV1`). Callers should validate via Ajv before
 * writing — the writers below do NOT re-validate to avoid pulling Ajv into
 * the request path; validation belongs on the ingest boundary.
 */

export interface PlanRow {
  version: number;
  created_at: string;
  created_by: "seed" | "user" | "proposal";
  parent_version: number | null;
  accepted_proposal_id: number | null;
  change_summary: string | null;
  is_active: boolean;
  payload: TrainingPlanV1;
  payload_sha256: string;
}

interface PlanRawRow {
  version: number;
  created_at: string;
  created_by: "seed" | "user" | "proposal";
  parent_version: number | null;
  accepted_proposal_id: number | null;
  change_summary: string | null;
  is_active: number;
  payload_json: string;
  payload_sha256: string;
}

function rowToPlan(row: PlanRawRow): PlanRow {
  return {
    version: row.version,
    created_at: row.created_at,
    created_by: row.created_by,
    parent_version: row.parent_version,
    accepted_proposal_id: row.accepted_proposal_id,
    change_summary: row.change_summary,
    is_active: row.is_active === 1,
    payload: JSON.parse(row.payload_json) as TrainingPlanV1,
    payload_sha256: row.payload_sha256,
  };
}

/** Active plan, or null when no plan has been imported yet. */
export function readActivePlan(): PlanRow | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[], PlanRawRow>(
        `SELECT version, created_at, created_by, parent_version, accepted_proposal_id,
                change_summary, is_active, payload_json, payload_sha256
         FROM PULSE_TRAINING_PLAN
         WHERE is_active = 1`,
      )
      .get();
    return row ? rowToPlan(row) : null;
  } catch {
    return null;
  }
}

export function readPlanVersion(version: number): PlanRow | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[number], PlanRawRow>(
        `SELECT version, created_at, created_by, parent_version, accepted_proposal_id,
                change_summary, is_active, payload_json, payload_sha256
         FROM PULSE_TRAINING_PLAN
         WHERE version = ?`,
      )
      .get(version);
    return row ? rowToPlan(row) : null;
  } catch {
    return null;
  }
}

export interface PlanVersionSummary {
  version: number;
  created_at: string;
  created_by: PlanRow["created_by"];
  parent_version: number | null;
  is_active: boolean;
  change_summary: string | null;
  accepted_proposal_id: number | null;
}

/** All plan versions, newest first. */
export function listPlanVersions(): PlanVersionSummary[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<
        [],
        {
          version: number;
          created_at: string;
          created_by: PlanRow["created_by"];
          parent_version: number | null;
          is_active: number;
          change_summary: string | null;
          accepted_proposal_id: number | null;
        }
      >(
        `SELECT version, created_at, created_by, parent_version, is_active, change_summary, accepted_proposal_id
         FROM PULSE_TRAINING_PLAN
         ORDER BY version DESC`,
      )
      .all();
    return rows.map((r) => ({
      version: r.version,
      created_at: r.created_at,
      created_by: r.created_by,
      parent_version: r.parent_version,
      is_active: r.is_active === 1,
      change_summary: r.change_summary,
      accepted_proposal_id: r.accepted_proposal_id,
    }));
  } catch {
    return [];
  }
}

export interface WritePlanInput {
  payload: TrainingPlanV1;
  created_by: PlanRow["created_by"];
  parent_version: number | null;
  accepted_proposal_id?: number | null;
  change_summary: string | null;
  set_active: boolean;
}

/**
 * Insert a new plan version. When `set_active=true`, the previous active row
 * (if any) flips to `is_active=0` first — done in a single transaction so
 * the partial-unique index never sees two active rows.
 *
 * Returns the inserted version number.
 */
export function writePlanVersion(input: WritePlanInput): number {
  const db = getWritableDb();
  const json = JSON.stringify(input.payload);
  const sha = createHash("sha256").update(json).digest("hex");

  const insert = db.prepare(
    `INSERT INTO PULSE_TRAINING_PLAN
       (created_by, parent_version, accepted_proposal_id, change_summary, is_active, payload_json, payload_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const deactivate = db.prepare(
    `UPDATE PULSE_TRAINING_PLAN SET is_active = 0 WHERE is_active = 1`,
  );

  const tx = db.transaction(() => {
    if (input.set_active) deactivate.run();
    const info = insert.run(
      input.created_by,
      input.parent_version,
      input.accepted_proposal_id ?? null,
      input.change_summary,
      input.set_active ? 1 : 0,
      json,
      sha,
    );
    return Number(info.lastInsertRowid);
  });

  return tx();
}

/** Used by the import endpoint to short-circuit if a plan already exists. */
export function planTableIsEmpty(): boolean {
  const db = pulseDb();
  if (!db) return true;
  try {
    const row = db
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM PULSE_TRAINING_PLAN`)
      .get();
    return (row?.c ?? 0) === 0;
  } catch {
    return true;
  }
}
