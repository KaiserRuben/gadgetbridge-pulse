import "server-only";
import { NextResponse } from "next/server";

import { readMeal, retryFailedMeal } from "@/lib/data/meal-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/nutrition/meal/<id>/retry
 *
 * Manual user action: flip a meal from `failed` back to `pending` so the
 * next reconcile tick picks it up. Idempotent — calling on a non-failed
 * row is a 409 (caller already shipped or the meal is mid-flight).
 *
 * No body required. No auth header — this is a user-driven dashboard
 * route, gated by whatever upstream auth fronts the dashboard.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const flipped = retryFailedMeal(id);
  if (!flipped) {
    return NextResponse.json(
      { ok: false, reason: "not_failed" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, meal: readMeal(id) });
}
