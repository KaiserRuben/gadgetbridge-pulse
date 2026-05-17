import { NextResponse } from "next/server";

import {
  finishSession,
  linkWearable,
  readSession,
  updateSessionMeta,
} from "@/lib/training/session";
import { listSetsForSession } from "@/lib/training/set-log";
import { listPainForSession } from "@/lib/training/pain";

export const dynamic = "force-dynamic";

/**
 * GET /api/training/session/:id — full session record including set logs and
 * pain flags. Used by the in-session resume flow + the session-detail page.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = readSession(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  const sets = listSetsForSession(id);
  const pain = listPainForSession(id);
  return NextResponse.json({ session, sets, pain });
}

/**
 * PATCH /api/training/session/:id — mutate session state.
 *
 * Three intents:
 *   { intent: 'finish', state: 'completed'|'abandoned', subjective_energy?, note? }
 *   { intent: 'update_meta', subjective_energy?, note? }
 *   { intent: 'link_wearable', wearable_workout_id: number|null, status: ... }
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
  const intent = typeof b.intent === "string" ? b.intent : null;

  try {
    if (intent === "finish") {
      const state = b.state === "completed" || b.state === "abandoned" ? b.state : null;
      if (!state) {
        return NextResponse.json({ error: "state must be completed or abandoned" }, { status: 400 });
      }
      const subjective_energy =
        typeof b.subjective_energy === "number" ? b.subjective_energy : null;
      const note = typeof b.note === "string" ? b.note : null;
      // Allow callers to back-date `completed_at` — used by retroactive
      // session creation where the wearable has the real end timestamp
      // and the client wants stitch matching to compare on real-world
      // windows rather than wall-clock now.
      const completed_at =
        typeof b.completed_at === "string" ? b.completed_at : undefined;
      const row = finishSession({ id, state, subjective_energy, note, completed_at });
      return NextResponse.json(row);
    }
    if (intent === "update_meta") {
      const subjective_energy =
        typeof b.subjective_energy === "number" ? b.subjective_energy : null;
      const note = typeof b.note === "string" ? b.note : null;
      const row = updateSessionMeta({ id, subjective_energy, note });
      return NextResponse.json(row);
    }
    if (intent === "link_wearable") {
      const wearable_workout_id =
        typeof b.wearable_workout_id === "number" ? b.wearable_workout_id : null;
      const allowed = ["none", "tentative", "confirmed", "manual"] as const;
      const status =
        typeof b.status === "string" && (allowed as readonly string[]).includes(b.status)
          ? (b.status as (typeof allowed)[number])
          : null;
      if (!status) {
        return NextResponse.json({ error: "status must be none|tentative|confirmed|manual" }, { status: 400 });
      }
      const row = linkWearable({ id, wearable_workout_id, status });
      return NextResponse.json(row);
    }
    return NextResponse.json({ error: "unknown intent" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
