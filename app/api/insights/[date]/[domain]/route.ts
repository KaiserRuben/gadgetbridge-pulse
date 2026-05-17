import { NextResponse } from "next/server";
import {
  loadDailyV3,
  loadSleepInsight,
  loadRecoveryInsight,
  loadActivityInsight,
  loadDayScore,
} from "@/lib/v3-loaders";

export const dynamic = "force-dynamic";

/**
 * GET /api/insights/[date]/[domain]
 * Domains: daily | sleep | recovery | activity | day_score
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
    case "daily":
      return loadDailyV3(date);
    case "sleep":
      return loadSleepInsight(date);
    case "recovery":
      return loadRecoveryInsight(date);
    case "activity":
      return loadActivityInsight(date);
    case "day_score":
      return loadDayScore(date);
    default:
      return undefined;
  }
}
