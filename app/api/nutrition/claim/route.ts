import "server-only";
import { NextResponse } from "next/server";

import { checkIngestAuth } from "@/lib/ingest/auth";
import { claimPendingMeal, readPendingForRunner } from "@/lib/data/meal-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/nutrition/claim
 * Body: { meal_id: string }
 *
 * Atomic pending→processing transition. Two terminal outcomes:
 *   200 { ok: true, meal: {...} }   — caller now owns the meal
 *   409 { ok: false, reason: ... } — already claimed or not in `pending`
 *
 * Returning the full meal payload (with photos[]) on success spares the
 * runner a second round-trip. A meal that doesn't exist also returns 409
 * — the runner shouldn't distinguish "gone" from "taken" for retry logic.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = checkIngestAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: { meal_id?: unknown };
  try {
    body = (await req.json()) as { meal_id?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const mealId = typeof body.meal_id === "string" ? body.meal_id.trim() : "";
  if (!mealId) {
    return NextResponse.json({ error: "meal_id required" }, { status: 400 });
  }

  const claimed = claimPendingMeal(mealId);
  if (!claimed) {
    return NextResponse.json(
      { ok: false, reason: "not_pending" },
      { status: 409 },
    );
  }

  const meal = readPendingForRunner(mealId);
  if (!meal) {
    // Race: row deleted between claim and read. Treat as terminal — the
    // runner has nothing to process.
    return NextResponse.json(
      { ok: false, reason: "vanished" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, meal });
}
