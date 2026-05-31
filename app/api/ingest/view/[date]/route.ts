/**
 * Pi-side ingest endpoint for v4 view-state diffs.
 *
 * Mac runner POSTs Tier1Diff / SlotDiff / MetaDiff JSON; this route routes
 * them to the shared ViewStateWriter, which is the SOLE writer of the
 * Pi-resident `$PULSE_VIEW_ROOT/view/<scope>/<period_key>.json` tree.
 *
 * Wire format:
 *   POST /api/ingest/view/<period_key>
 *   body: { kind: "tier1" | "slot" | "meta", ...diff }
 *
 * Responses:
 *   200 { ok: true, version: <new view.version> }
 *   400 { ok: false, code: "bad_request", error: string }
 *   409 { ok: false, code: "version_conflict", current_version: number }
 *   500 { ok: false, code: "write_failed", error: string }
 */

import { NextResponse } from "next/server";

import { detectScope, getWriter } from "@/lib/view-state/shared";
import { VersionConflictError } from "@/runner/v4/view-state/writer.ts";
import type {
  MetaDiff,
  SlotDiff,
  Tier1Diff,
} from "@/runner/v4/types.ts";

interface IngestBody {
  kind?: string;
  scope?: string;
  period_key?: string;
  expected_version?: number;
  [extra: string]: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ date: string }> },
): Promise<NextResponse> {
  const { date } = await params;
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "bad_request",
        error: `invalid json: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  if (!body.kind || !body.scope || !body.period_key) {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: "missing kind/scope/period_key" },
      { status: 400 },
    );
  }
  if (body.period_key !== date) {
    return NextResponse.json(
      {
        ok: false,
        code: "bad_request",
        error: `period_key in body (${body.period_key}) does not match url (${date})`,
      },
      { status: 400 },
    );
  }

  const w = getWriter();

  try {
    let next;
    switch (body.kind) {
      case "tier1":
        next = await w.applyTier1(body as unknown as Tier1Diff);
        break;
      case "slot":
        next = await w.applySlot(body as unknown as SlotDiff);
        break;
      case "meta":
        next = await w.applyMeta(body as unknown as MetaDiff);
        break;
      default:
        return NextResponse.json(
          { ok: false, code: "bad_request", error: `unknown kind: ${body.kind}` },
          { status: 400 },
        );
    }
    return NextResponse.json({ ok: true, version: next.version }, { status: 200 });
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return NextResponse.json(
        {
          ok: false,
          code: "version_conflict",
          expected: err.expected,
          current_version: err.actual,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "write_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

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
  const view = await getWriter().read(scope, date);
  if (!view) {
    return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
  }
  return NextResponse.json(view, { status: 200 });
}
