import "server-only";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";
import type {
  TrainingAdjustmentProposalV1,
  TrainingPlanV1,
} from "../types/generated";
import { readActivePlan, writePlanVersion } from "./plan";

/**
 * PULSE_ADJUSTMENT_PROPOSAL access.
 *
 * Status flow: pending → (accepted | rejected | edited)
 *   - accepted: applies diff to the active plan, writes plan_v(n+1), marks
 *     the proposal resolved.
 *   - rejected: keeps the row for future LLM context, no plan mutation.
 *   - edited: marks the proposal closed; the actual change lives in a new
 *     plan version with `created_by='user'` and `accepted_proposal_id`
 *     pointing back here.
 */

export interface ProposalRow {
  id: number;
  generated_at: string;
  model: string | null;
  prompt_version: string | null;
  target_plan_version: number;
  scope: TrainingAdjustmentProposalV1["scope"];
  diff: TrainingAdjustmentProposalV1["diff"];
  reasoning_trace: string;
  summary_de: string | null;
  cited_data: TrainingAdjustmentProposalV1["cited_data"];
  status: TrainingAdjustmentProposalV1["status"];
  resolved_at: string | null;
  resolution_note: string | null;
}

interface RawRow {
  id: number;
  generated_at: string;
  model: string | null;
  prompt_version: string | null;
  target_plan_version: number;
  scope: string;
  diff_json: string;
  reasoning_trace: string;
  summary_de: string | null;
  cited_data_json: string;
  status: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

const SELECT_COLS = `
  id, generated_at, model, prompt_version, target_plan_version, scope,
  diff_json, reasoning_trace, summary_de, cited_data_json,
  status, resolved_at, resolution_note
`;

function rowToProposal(r: RawRow): ProposalRow {
  return {
    id: r.id,
    generated_at: r.generated_at,
    model: r.model,
    prompt_version: r.prompt_version,
    target_plan_version: r.target_plan_version,
    scope: r.scope as ProposalRow["scope"],
    diff: JSON.parse(r.diff_json) as ProposalRow["diff"],
    reasoning_trace: r.reasoning_trace,
    summary_de: r.summary_de,
    cited_data: JSON.parse(r.cited_data_json) as ProposalRow["cited_data"],
    status: r.status as ProposalRow["status"],
    resolved_at: r.resolved_at,
    resolution_note: r.resolution_note,
  };
}

export function readProposal(id: number): ProposalRow | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[number], RawRow>(
        `SELECT ${SELECT_COLS} FROM PULSE_ADJUSTMENT_PROPOSAL WHERE id = ?`,
      )
      .get(id);
    return row ? rowToProposal(row) : null;
  } catch {
    return null;
  }
}

export function listProposals(
  status?: ProposalRow["status"],
  limit = 50,
): ProposalRow[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = status
      ? db
          .prepare<[string], RawRow>(
            `SELECT ${SELECT_COLS} FROM PULSE_ADJUSTMENT_PROPOSAL
             WHERE status = ?
             ORDER BY generated_at DESC
             LIMIT ${limit}`,
          )
          .all(status)
      : db
          .prepare<[], RawRow>(
            `SELECT ${SELECT_COLS} FROM PULSE_ADJUSTMENT_PROPOSAL
             ORDER BY generated_at DESC
             LIMIT ${limit}`,
          )
          .all();
    return rows.map(rowToProposal);
  } catch {
    return [];
  }
}

export interface CreateProposalInput {
  target_plan_version: number;
  scope: ProposalRow["scope"];
  diff: ProposalRow["diff"];
  reasoning_trace: string;
  summary_de?: string | null;
  cited_data: ProposalRow["cited_data"];
  model?: string | null;
  prompt_version?: string | null;
}

export function createProposal(input: CreateProposalInput): number {
  const db = getWritableDb();
  const info = db
    .prepare(
      `INSERT INTO PULSE_ADJUSTMENT_PROPOSAL
         (model, prompt_version, target_plan_version, scope, diff_json,
          reasoning_trace, summary_de, cited_data_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(
      input.model ?? null,
      input.prompt_version ?? null,
      input.target_plan_version,
      input.scope,
      JSON.stringify(input.diff),
      input.reasoning_trace,
      input.summary_de ?? null,
      JSON.stringify(input.cited_data),
    );
  return Number(info.lastInsertRowid);
}

/**
 * Apply an accepted proposal: clone the active plan, apply each diff op,
 * write a new plan version with `created_by='proposal'` + `accepted_proposal_id`
 * pointing to this proposal, mark the proposal as accepted.
 *
 * All in one DB transaction so partial failure cannot leave a half-applied
 * plan + accepted proposal mismatch.
 */
export interface AcceptResult {
  ok: true;
  new_plan_version: number;
  proposal_id: number;
}

export interface AcceptError {
  ok: false;
  error: string;
}

export function acceptProposal(id: number, resolutionNote: string | null): AcceptResult | AcceptError {
  const proposal = readProposal(id);
  if (!proposal) return { ok: false, error: "proposal not found" };
  if (proposal.status !== "pending") {
    return { ok: false, error: `proposal already ${proposal.status}` };
  }
  const active = readActivePlan();
  if (!active) return { ok: false, error: "no active plan" };
  if (active.version !== proposal.target_plan_version) {
    return {
      ok: false,
      error: `proposal targets plan v${proposal.target_plan_version} but active is v${active.version}; refresh + regenerate`,
    };
  }

  let nextPayload: TrainingPlanV1;
  try {
    nextPayload = applyDiff(active.payload, proposal.diff);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Stamp created_at fresh so the new version has a real timestamp.
  nextPayload = { ...nextPayload, created_at: new Date().toISOString() };

  const newVersion = writePlanVersion({
    payload: nextPayload,
    created_by: "proposal",
    parent_version: active.version,
    accepted_proposal_id: id,
    change_summary:
      resolutionNote ?? proposal.summary_de ?? `Vorschlag #${id} angenommen`,
    set_active: true,
  });

  const db = getWritableDb();
  db.prepare(
    `UPDATE PULSE_ADJUSTMENT_PROPOSAL
     SET status = 'accepted', resolved_at = ?, resolution_note = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), resolutionNote, id);

  return { ok: true, new_plan_version: newVersion, proposal_id: id };
}

export function rejectProposal(id: number, resolutionNote: string | null): boolean {
  const db = getWritableDb();
  const info = db
    .prepare(
      `UPDATE PULSE_ADJUSTMENT_PROPOSAL
       SET status = 'rejected', resolved_at = ?, resolution_note = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(new Date().toISOString(), resolutionNote, id);
  return info.changes > 0;
}

// ── Diff application ─────────────────────────────────────────────────────────

type Pointer = (string | number)[];

function decodePointer(path: string): Pointer {
  if (path === "/") return [];
  if (!path.startsWith("/")) throw new Error(`invalid JSON Pointer: ${path}`);
  return path
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** Coerce string segments that look like array indices into numbers. */
function coerceSegment(parent: unknown, segment: string): string | number {
  if (Array.isArray(parent) && /^\d+$/.test(segment)) return Number(segment);
  return segment;
}

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function walk(root: unknown, pointer: Pointer, create: boolean): { parent: unknown; key: string | number } {
  let cur: unknown = root;
  for (let i = 0; i < pointer.length - 1; i++) {
    const seg = coerceSegment(cur, String(pointer[i]));
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) throw new Error(`expected array at ${pointer.slice(0, i).join("/")}`);
      if (cur[seg] === undefined) {
        if (!create) throw new Error(`path missing at ${pointer.slice(0, i + 1).join("/")}`);
        cur[seg] = {};
      }
      cur = cur[seg];
    } else {
      if (typeof cur !== "object" || cur === null) {
        throw new Error(`expected object at ${pointer.slice(0, i).join("/")}`);
      }
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) {
        if (!create) throw new Error(`path missing at ${pointer.slice(0, i + 1).join("/")}`);
        obj[seg] = {};
      }
      cur = obj[seg];
    }
  }
  const lastSeg = coerceSegment(cur, String(pointer[pointer.length - 1]));
  return { parent: cur, key: lastSeg };
}

export function applyDiff(
  base: TrainingPlanV1,
  ops: ProposalRow["diff"],
): TrainingPlanV1 {
  const draft = cloneDeep(base);
  for (const op of ops) {
    const pointer = decodePointer(op.path);
    if (op.op === "insert" && pointer.length === 0) {
      // Root insert = replace whole plan with `after`.
      if (typeof op.after !== "object" || op.after === null) {
        throw new Error("root insert requires object `after`");
      }
      return cloneDeep(op.after as TrainingPlanV1);
    }
    const { parent, key } = walk(draft, pointer, op.op === "insert");
    if (op.op === "remove") {
      if (Array.isArray(parent) && typeof key === "number") {
        parent.splice(key, 1);
      } else if (typeof parent === "object" && parent !== null) {
        delete (parent as Record<string, unknown>)[String(key)];
      } else {
        throw new Error(`cannot remove from non-container at ${op.path}`);
      }
    } else if (op.op === "set" || op.op === "replace" || op.op === "insert") {
      if (Array.isArray(parent) && typeof key === "number") {
        if (op.op === "insert") {
          parent.splice(key, 0, op.after);
        } else {
          parent[key] = op.after;
        }
      } else if (typeof parent === "object" && parent !== null) {
        (parent as Record<string, unknown>)[String(key)] = op.after;
      } else {
        throw new Error(`cannot ${op.op} on non-container at ${op.path}`);
      }
    } else {
      throw new Error(`unknown diff op: ${(op as { op: string }).op}`);
    }
  }
  return draft;
}
