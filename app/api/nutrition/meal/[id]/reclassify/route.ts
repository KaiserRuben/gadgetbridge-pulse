import "server-only";
import { NextResponse } from "next/server";

import { readMeal, resetMealToPending } from "@/lib/data/meal-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/nutrition/meal/<id>/reclassify
 *
 * Flips a non-pending meal back to `pending` so the next runner reconcile
 * tick reruns the VLM. Used by the dashboard "Neu klassifizieren" action
 * and as the recovery hook for `status='failed'` rows.
 *
 * 200 → row was flipped, the next tick will pick it up.
 * 409 → row is already `pending` (in-flight) or doesn't exist.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const flipped = resetMealToPending(id);
  if (!flipped) {
    return NextResponse.json(
      { ok: false, reason: "already_pending_or_missing" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, meal: readMeal(id) });
}
