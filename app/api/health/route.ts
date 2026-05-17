import { NextResponse } from "next/server";
import { db, dbStat } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const handle = db();
    const result = handle
      .prepare("SELECT COUNT(*) AS n FROM HUAWEI_ACTIVITY_SAMPLE")
      .get() as { n: number };
    const stat = dbStat();
    return NextResponse.json({
      ok: true,
      activityRows: result.n,
      ...stat,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
