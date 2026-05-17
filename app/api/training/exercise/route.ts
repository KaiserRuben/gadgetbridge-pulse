import { NextResponse } from "next/server";

import { listExercises } from "@/lib/training/exercise";

export const dynamic = "force-dynamic";

/**
 * GET /api/training/exercise[?movement_pattern=…]
 *
 * Lists the canonical exercise library. Used by the in-session substitute
 * picker and the plan-editor UI.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pattern = url.searchParams.get("movement_pattern") ?? undefined;
  const items = listExercises(pattern ? { movement_pattern: pattern } : undefined);
  return NextResponse.json({ items, count: items.length });
}
