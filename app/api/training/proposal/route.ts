import { NextResponse } from "next/server";

import { createProposal, listProposals, type ProposalRow } from "@/lib/training/proposal";
import { validateAdjustmentProposal } from "@/lib/training/validate";

export const dynamic = "force-dynamic";

/**
 * GET /api/training/proposal[?status=…&limit=…]
 *
 * Lists adjustment proposals. The UI's pending-inbox uses status=pending;
 * the history view uses unfiltered.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? undefined;
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const allowedStatus = ["pending", "accepted", "rejected", "edited"] as const;
  const status =
    statusParam && (allowedStatus as readonly string[]).includes(statusParam)
      ? (statusParam as (typeof allowedStatus)[number])
      : undefined;
  const items = listProposals(
    status,
    Number.isFinite(limit) ? Math.min(limit, 200) : 50,
  );
  return NextResponse.json({ items, count: items.length });
}

/**
 * POST /api/training/proposal — create a proposal. Used by the runner's
 * training use-case when it surfaces a recommended plan change, and by
 * the chat surface's structured-extraction step.
 *
 * Body shape mirrors `adjustment-proposal.schema.json`, minus id +
 * status + resolved_at (server-managed).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const target_plan_version = typeof b.target_plan_version === "number" ? b.target_plan_version : null;
  const scopeStr = typeof b.scope === "string" ? b.scope : null;
  const validScope = ["exercise", "session_template", "phase", "global"] as const;
  const scope =
    scopeStr && (validScope as readonly string[]).includes(scopeStr)
      ? (scopeStr as ProposalRow["scope"])
      : null;
  const reasoning_trace = typeof b.reasoning_trace === "string" ? b.reasoning_trace : null;
  if (!target_plan_version || !scope || !reasoning_trace) {
    return NextResponse.json(
      { error: "target_plan_version, scope, reasoning_trace required" },
      { status: 400 },
    );
  }
  const diff = Array.isArray(b.diff) ? (b.diff as ProposalRow["diff"]) : null;
  if (!diff || diff.length === 0) {
    return NextResponse.json({ error: "diff must be a non-empty array" }, { status: 400 });
  }
  const cited_data = Array.isArray(b.cited_data) ? (b.cited_data as ProposalRow["cited_data"]) : [];
  const summary_de = typeof b.summary_de === "string" ? b.summary_de : null;
  const model = typeof b.model === "string" ? b.model : null;
  const prompt_version = typeof b.prompt_version === "string" ? b.prompt_version : null;

  const probe = {
    schema_version: "training/adjustment_proposal/v1",
    id: 0,
    generated_at: new Date().toISOString(),
    target_plan_version,
    scope,
    diff,
    reasoning_trace,
    summary_de,
    cited_data,
    status: "pending",
    resolved_at: null,
    resolution_note: null,
    model,
    prompt_version,
  };
  const v = validateAdjustmentProposal(probe);
  if (!v.ok) {
    return NextResponse.json(
      { error: `proposal invalid: ${v.errors.slice(0, 5).join("; ")}` },
      { status: 400 },
    );
  }
  const id = createProposal({
    target_plan_version,
    scope,
    diff,
    reasoning_trace,
    summary_de,
    cited_data,
    model,
    prompt_version,
  });
  return NextResponse.json({ ok: true, id });
}
