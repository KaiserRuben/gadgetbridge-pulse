import { NextResponse } from "next/server";

import { linkWearable, readSession } from "@/lib/training/session";
import { loadCandidatesAround } from "@/lib/training/wearable-candidates";
import { evaluateStitch } from "@/lib/training/wearable-stitch";

export const dynamic = "force-dynamic";

/**
 * GET /api/training/session/:id/stitch — preview the auto-stitch outcome
 * without writing. Returns the picked candidate + alternatives so the UI
 * can render either the auto-link badge or a manual picker.
 *
 * POST /api/training/session/:id/stitch — apply a manual link.
 *   Body: { wearable_workout_id: number | null, status?: "manual" }
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = readSession(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.completed_at) {
    return NextResponse.json(
      { ok: true, status: "none", reason: "session_incomplete", pick: null, alternatives: [] },
    );
  }
  const candidates = loadCandidatesAround(session.started_at, session.completed_at);
  const outcome = evaluateStitch({
    session: {
      started_at: session.started_at,
      completed_at: session.completed_at,
      period_key: session.period_key,
    },
    candidates,
  });
  return NextResponse.json({
    ok: true,
    ...outcome,
    current_link: {
      wearable_workout_id: session.wearable_workout_id,
      status: session.wearable_link_status,
      resolved_at: session.wearable_link_resolved_at,
    },
  });
}

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
  const wid = typeof b.wearable_workout_id === "number" ? b.wearable_workout_id : null;
  const allowed = ["manual", "confirmed", "none"] as const;
  const status =
    typeof b.status === "string" && (allowed as readonly string[]).includes(b.status)
      ? (b.status as (typeof allowed)[number])
      : "manual";
  try {
    const row = linkWearable({ id, wearable_workout_id: wid, status });
    return NextResponse.json({ ok: true, session: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
