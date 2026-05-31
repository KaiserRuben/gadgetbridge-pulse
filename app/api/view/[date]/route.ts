/**
 * View-state read endpoint — UI loader.
 *
 * GET /api/view/<period_key>
 *   - daily: YYYY-MM-DD
 *   - weekly: YYYY-Www
 *
 * Returns the full ViewState document; 404 if not yet computed.
 * No-store: dashboard always wants the live document, and SSE delivers
 * subsequent deltas.
 */

import { NextResponse } from "next/server";

import { detectScope, getReader } from "@/lib/view-state/shared";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
): Promise<NextResponse> {
  const { date } = await params;
  const scope = detectScope(date);
  if (!scope) {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: `invalid period_key: ${date}` },
      { status: 400 },
    );
  }

  try {
    const view = await getReader().read(scope, date);
    if (!view) {
      return NextResponse.json(
        { ok: false, code: "not_found", period_key: date, scope },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(view, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "read_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
