import { NextResponse } from "next/server";

import { checkIngestAuth } from "@/lib/ingest/auth";
import { readStateKv } from "@/lib/data/period-store";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const auth = checkIngestAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const { key } = await params;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  return NextResponse.json({ key, value: readStateKv(key) });
}
