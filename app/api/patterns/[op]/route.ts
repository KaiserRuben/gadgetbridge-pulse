import { NextResponse } from "next/server";

import { checkIngestAuth } from "@/lib/ingest/auth";
import {
  bumpPattern,
  listPatterns,
  markPatternConfirmed,
  upsertPattern,
  type PatternEntry,
} from "@/lib/data/pattern-library-store";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ op: string }> },
) {
  const auth = checkIngestAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const { op } = await params;
  const url = new URL(req.url);
  if (op !== "list") {
    return NextResponse.json({ error: `GET supports only /list (got ${op})` }, { status: 404 });
  }
  const limitRaw = url.searchParams.get("limit");
  const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 50;
  return NextResponse.json({ patterns: listPatterns(limit) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ op: string }> },
) {
  const auth = checkIngestAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const { op } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    switch (op) {
      case "upsert": {
        const entry = body.entry as Omit<PatternEntry, "occurrence_count" | "user_confirmed">;
        // name_de is required on INSERT but the runner passes "" on the
        // bump-existing path (UPDATE keeps the stored name). The store
        // distinguishes by row existence and throws when the INSERT branch
        // hits with an empty name. Pre-flight here only on always-required
        // fields.
        if (!entry?.id || !entry?.signature_json || !entry?.first_seen || !entry?.last_seen) {
          return NextResponse.json(
            { error: "upsert requires entry.{id,signature_json,first_seen,last_seen}" },
            { status: 400 },
          );
        }
        const fresh = upsertPattern(entry);
        return NextResponse.json({ pattern: fresh });
      }
      case "bump": {
        const id = body.id as string;
        const last_seen = body.last_seen as string;
        if (!id || !last_seen) {
          return NextResponse.json(
            { error: "bump requires id, last_seen" },
            { status: 400 },
          );
        }
        const fresh = bumpPattern(id, last_seen);
        if (!fresh) {
          return NextResponse.json({ error: `bump: id not found: ${id}` }, { status: 404 });
        }
        return NextResponse.json({ pattern: fresh });
      }
      case "confirm": {
        const id = body.id as string;
        const name_de = body.name_de as string | undefined;
        if (!id) return NextResponse.json({ error: "confirm requires id" }, { status: 400 });
        markPatternConfirmed(id, name_de);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `unknown op: ${op}` }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
