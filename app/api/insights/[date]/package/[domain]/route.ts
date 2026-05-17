import { NextResponse } from "next/server";
import {
  loadSleepPackage,
  loadRecoveryPackage,
  loadActivityPackage,
} from "@/lib/v3-loaders";

export const dynamic = "force-dynamic";

/**
 * GET /api/insights/[date]/package/[domain]
 * Domains: sleep | recovery | activity
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string; domain: string }> },
) {
  const { date, domain } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const data = await loadByDomain(date, domain);
  if (data === undefined) {
    return NextResponse.json({ error: "unknown domain" }, { status: 404 });
  }
  if (data === null) {
    return NextResponse.json({ error: "not found", date, domain }, { status: 404 });
  }
  return NextResponse.json(data);
}

async function loadByDomain(date: string, domain: string): Promise<unknown> {
  switch (domain) {
    case "sleep":
      return loadSleepPackage(date);
    case "recovery":
      return loadRecoveryPackage(date);
    case "activity":
      return loadActivityPackage(date);
    default:
      return undefined;
  }
}
