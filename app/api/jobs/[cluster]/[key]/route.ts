import { NextResponse } from "next/server";

import { readInsight, type InsightStatus, type Scope } from "@/lib/data/period-store";
import type { ProvenanceTag } from "@/runner/jobs/types";

export const dynamic = "force-dynamic";

/**
 * Dashboard read for a single JobCell. Maps the PULSE_INSIGHT row to the
 * front-end CellState contract:
 *   - never_computed: no row, or status='pending' with no prior payload
 *   - reprocessing : row exists with payload AND leased_at IS NOT NULL
 *   - ready_cached : status='pending' but payload still present (stale)
 *   - ready_fresh  : status='complete'
 *   - error        : status='partial'
 */

export type CellState =
  | "never_computed"
  | "reprocessing"
  | "ready_cached"
  | "ready_fresh"
  | "error";

interface CellResponse {
  state: CellState;
  payload: unknown;
  provenance: ProvenanceTag[];
  started_at: string | null;
  error_text: string | null;
  updated_at: string;
}

const SCOPES: readonly Scope[] = ["daily", "weekly"];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ cluster: string; key: string }> },
) {
  const { cluster, key } = await params;
  const scopeRaw = new URL(req.url).searchParams.get("scope") ?? "daily";
  if (!SCOPES.includes(scopeRaw as Scope)) {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }
  const scope = scopeRaw as Scope;
  const row = readInsight(key, cluster, scope);
  if (!row) {
    const empty: CellResponse = {
      state: "never_computed",
      payload: null,
      provenance: [],
      started_at: null,
      error_text: null,
      updated_at: new Date().toISOString(),
    };
    return NextResponse.json(empty);
  }
  const { payload, provenance } = splitPayload(row.payload);
  const body: CellResponse = {
    state: deriveState(row.status, row.leasedAt ?? null, payload),
    payload,
    provenance,
    started_at: row.startedAt ?? null,
    error_text: row.errorText ?? null,
    updated_at: row.updatedAt,
  };
  return NextResponse.json(body);
}

function deriveState(
  status: InsightStatus,
  leasedAt: string | null,
  payload: unknown,
): CellState {
  const hasPayload =
    payload !== null && payload !== undefined &&
    !(typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload as object).length === 0);
  if (status === "partial") return "error";
  if (status === "complete") return "ready_fresh";
  // Pending/live branches depend on whether work is in flight + prior cache.
  if (leasedAt) return hasPayload ? "reprocessing" : "never_computed";
  if (hasPayload) return "ready_cached";
  return "never_computed";
}

/**
 * Older PULSE_INSIGHT rows store the raw payload as the top-level JSON;
 * JobCell-style rows wrap it as `{ payload, provenance }`. Accept both so
 * the route works during the migration window where mixed shapes coexist.
 */
function splitPayload(
  raw: unknown,
): { payload: unknown; provenance: ProvenanceTag[] } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if ("payload" in obj || "provenance" in obj) {
      const prov = obj.provenance;
      return {
        payload: obj.payload ?? null,
        provenance: Array.isArray(prov) ? (prov as ProvenanceTag[]) : [],
      };
    }
  }
  return { payload: raw ?? null, provenance: [] };
}
