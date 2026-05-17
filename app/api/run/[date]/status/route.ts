import { NextResponse } from "next/server";
import { loadDailyV3Status } from "@/lib/v3-loaders";

export const dynamic = "force-dynamic";

/**
 * GET /api/run/[date]/status
 * Returns DailyV3Status: presence + mtime per artifact. Used by run-progress UI
 * as a polling fallback when WS isn't available.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  const status = await loadDailyV3Status(date);
  return NextResponse.json(status);
}
