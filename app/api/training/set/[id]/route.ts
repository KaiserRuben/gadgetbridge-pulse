import { NextResponse } from "next/server";

import { deleteSet, readSet, upsertSet } from "@/lib/training/set-log";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/training/set/:id — edit a previously logged set. Persists an
 * audit row before the update so the original numbers stay recoverable
 * (Q6 in TRAINING_PLAN_DESIGN.md).
 *
 * The PATCH body shape mirrors the POST body of `…/session/:id/set` except
 * that `set_idx` is fixed (cannot be reassigned by editing).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  const existing = readSet(id);
  if (!existing) return NextResponse.json({ error: "set not found" }, { status: 404 });

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
  const sideEnum = ["both", "left", "right"] as const;
  const sideRaw = typeof b.side === "string" ? b.side : null;
  const side =
    sideRaw && (sideEnum as readonly string[]).includes(sideRaw)
      ? (sideRaw as (typeof sideEnum)[number])
      : existing.side;

  try {
    const row = upsertSet({
      actual_session_id: existing.actual_session_id,
      exercise_id: existing.exercise_id,
      set_idx: existing.set_idx,
      reps: typeof b.reps === "number" ? b.reps : "reps" in b ? null : existing.reps,
      weight_kg:
        typeof b.weight_kg === "number" ? b.weight_kg : "weight_kg" in b ? null : existing.weight_kg,
      duration_sec:
        typeof b.duration_sec === "number"
          ? b.duration_sec
          : "duration_sec" in b
            ? null
            : existing.duration_sec,
      distance_m:
        typeof b.distance_m === "number" ? b.distance_m : "distance_m" in b ? null : existing.distance_m,
      rpe: typeof b.rpe === "number" ? b.rpe : "rpe" in b ? null : existing.rpe,
      rir: typeof b.rir === "number" ? b.rir : "rir" in b ? null : existing.rir,
      side,
      note: typeof b.note === "string" ? b.note : "note" in b ? null : existing.note,
    });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/training/set/:id — soft-removes a set (audit row preserves the
 * pre-delete payload). Use sparingly — abandoning the session is usually
 * the right move when the user wants to throw away an entry.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  const ok = deleteSet(id);
  if (!ok) return NextResponse.json({ error: "set not found" }, { status: 404 });
  return NextResponse.json({ ok: true, id });
}
