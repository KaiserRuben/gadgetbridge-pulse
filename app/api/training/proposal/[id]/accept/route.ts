import { NextResponse } from "next/server";

import { acceptProposal } from "@/lib/training/proposal";

export const dynamic = "force-dynamic";

/**
 * POST /api/training/proposal/:id/accept
 *
 * Body: { resolution_note?: string }
 *
 * Applies the diff to the active plan, writes plan_v(n+1), marks the
 * proposal as accepted, all in one DB transaction (see acceptProposal).
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
  const result = acceptProposal(id, resolution_note);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
