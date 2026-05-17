import { NextResponse } from "next/server";

import { createSession, listSessions, type CreateSessionInput } from "@/lib/training/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/training/session — start (or resume) an actual session.
 *
 * Body shape:
 *   {
 *     id: uuid,                       // client-minted for offline-first
 *     period_key: "YYYY-MM-DD",
 *     session_template_id: string|null,
 *     planned_session_id?: number|null,
 *     deviation_reason?: 'user_choice'|'recovery'|'schedule'|'other'|null,
 *     started_at?: ISO
 *   }
 *
 * Idempotent — re-POSTing with the same id returns the existing row.
 */
export async function POST(req: Request) {
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
  const id = typeof b.id === "string" ? b.id : null;
  const period_key = typeof b.period_key === "string" ? b.period_key : null;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }
  if (!period_key || !/^\d{4}-\d{2}-\d{2}$/.test(period_key)) {
    return NextResponse.json({ error: "period_key must be YYYY-MM-DD" }, { status: 400 });
  }
  const session_template_id =
    typeof b.session_template_id === "string" ? b.session_template_id : null;
  const planned_session_id =
    typeof b.planned_session_id === "number" ? b.planned_session_id : null;
  const allowedDev = ["user_choice", "recovery", "schedule", "other"] as const;
  const deviation_reason =
    typeof b.deviation_reason === "string" &&
    (allowedDev as readonly string[]).includes(b.deviation_reason)
      ? (b.deviation_reason as CreateSessionInput["deviation_reason"])
      : null;
  const started_at = typeof b.started_at === "string" ? b.started_at : undefined;

  try {
    const row = createSession({
      id,
      period_key,
      session_template_id,
      planned_session_id,
      deviation_reason,
      started_at,
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
 * GET /api/training/session[?period_key=…&state=…&limit=…]
 *
 * Lists sessions newest first. Defaults: no filter, limit 100.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const period_key = url.searchParams.get("period_key") ?? undefined;
  const stateParam = url.searchParams.get("state") ?? undefined;
  const since_iso = url.searchParams.get("since_iso") ?? undefined;
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const validStates = new Set(["in_progress", "completed", "abandoned"]);
  const state =
    stateParam && validStates.has(stateParam)
      ? (stateParam as "in_progress" | "completed" | "abandoned")
      : undefined;
  const items = listSessions({
    period_key,
    state,
    since_iso,
    limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100,
  });
  return NextResponse.json({ items, count: items.length });
}
