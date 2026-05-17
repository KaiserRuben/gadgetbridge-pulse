import { NextResponse } from "next/server";

import { upsertSet } from "@/lib/training/set-log";

export const dynamic = "force-dynamic";

/**
 * POST /api/training/session/:id/set — upsert a single set.
 *
 * Body:
 *   {
 *     exercise_id: string,
 *     set_idx: number,
 *     reps?: number,
 *     weight_kg?: number,
 *     duration_sec?: number,
 *     distance_m?: number,
 *     rpe?: number,
 *     rir?: number,
 *     side?: 'both'|'left'|'right',
 *     note?: string,
 *     logged_at?: ISO
 *   }
 *
 * Idempotent on (session, exercise_id, set_idx) — a re-POST during a flaky
 * gym connection updates the existing row and writes an audit entry. The
 * client's IDB queue can replay safely.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const exercise_id = typeof b.exercise_id === "string" ? b.exercise_id : null;
  const set_idx = typeof b.set_idx === "number" ? b.set_idx : null;
  if (!exercise_id) return NextResponse.json({ error: "exercise_id required" }, { status: 400 });
  if (set_idx == null || set_idx < 1 || set_idx > 99) {
    return NextResponse.json({ error: "set_idx must be 1..99" }, { status: 400 });
  }
  const sideEnum = ["both", "left", "right"] as const;
  const side =
    typeof b.side === "string" && (sideEnum as readonly string[]).includes(b.side)
      ? (b.side as (typeof sideEnum)[number])
      : null;

  try {
    const row = upsertSet({
      actual_session_id: id,
      exercise_id,
      set_idx,
      reps: typeof b.reps === "number" ? b.reps : null,
      weight_kg: typeof b.weight_kg === "number" ? b.weight_kg : null,
      duration_sec: typeof b.duration_sec === "number" ? b.duration_sec : null,
      distance_m: typeof b.distance_m === "number" ? b.distance_m : null,
      rpe: typeof b.rpe === "number" ? b.rpe : null,
      rir: typeof b.rir === "number" ? b.rir : null,
      side,
      note: typeof b.note === "string" ? b.note : null,
      logged_at: typeof b.logged_at === "string" ? b.logged_at : undefined,
    });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
