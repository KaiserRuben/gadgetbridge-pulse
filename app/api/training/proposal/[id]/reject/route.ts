import { NextResponse } from "next/server";

import { rejectProposal } from "@/lib/training/proposal";

export const dynamic = "force-dynamic";

/**
 * POST /api/training/proposal/:id/reject
 *
 * Body: { resolution_note?: string }
 *
 * Marks the proposal rejected. The row stays around so the LLM context
 * bundle can cite rejected proposals as a learning signal.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  let body: unknown = {};
  try {
    if (req.headers.get("content-length") !== "0") body = await req.json();
  } catch {
    /* allow empty body */
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const resolution_note = typeof b.resolution_note === "string" ? b.resolution_note : null;
  const ok = rejectProposal(id, resolution_note);
  if (!ok) {
    return NextResponse.json({ error: "proposal not found or already resolved" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id });
}
