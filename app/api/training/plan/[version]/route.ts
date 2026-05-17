import { NextResponse } from "next/server";

import { readPlanVersion } from "@/lib/training/plan";

export const dynamic = "force-dynamic";

/**
 * GET /api/training/plan/:version — fetch a specific plan version, including
 * archived ones. Used by the plan-history timeline and the diff view.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ version: string }> },
) {
  const { version: versionStr } = await ctx.params;
  const version = Number.parseInt(versionStr, 10);
  if (!Number.isFinite(version) || version < 1) {
    return NextResponse.json({ error: "version must be a positive integer" }, { status: 400 });
  }
  const row = readPlanVersion(version);
  if (!row) {
    return NextResponse.json({ error: "version not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}
