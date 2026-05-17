import { NextResponse } from "next/server";

import {
  listPlanVersions,
  readActivePlan,
} from "@/lib/training/plan";

export const dynamic = "force-dynamic";

/**
 * GET /api/training/plan
 *
 * Returns the active plan document and the version history. Both are bundled
 * so a single round-trip from the client gets enough to render the plan view
 * and the history timeline without N+1.
 */
export async function GET() {
  const active = readActivePlan();
  const versions = listPlanVersions();
  return NextResponse.json({
    active,
    versions,
  });
}
