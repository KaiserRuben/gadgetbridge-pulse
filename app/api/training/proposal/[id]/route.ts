import { NextResponse } from "next/server";

import { readProposal } from "@/lib/training/proposal";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  const row = readProposal(id);
  if (!row) return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  return NextResponse.json(row);
}
