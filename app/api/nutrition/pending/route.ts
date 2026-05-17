import "server-only";
import { NextResponse } from "next/server";

import { checkIngestAuth } from "@/lib/ingest/auth";
import { listPendingForRunner, sweepStaleLeases } from "@/lib/data/meal-store";

export const dynamic = "force-dynamic";

/** Stale-lease TTL. Anything in `processing` longer than this is treated as
 *  crashed and flipped to `failed`. 30 min is generous vs a VLM call (~60s). */
const LEASE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_LIMIT = 16;
const MAX_LIMIT = 64;

/**
 * GET /api/nutrition/pending?limit=N
 *
 * Returns oldest-first `status='pending'` meals for the Mac runner to claim
 * and classify. Each row carries its photos[] so the runner doesn't have to
 * follow-up with another query.
 *
 * Side effect: sweeps stale `processing` rows before returning the list, so
 * a runner that crashed mid-flight gets its rows surfaced as `failed` rather
 * than wedged in `processing` forever. The sweep is cheap (indexed update)
 * and serialised by sqlite, so multiple concurrent callers can't race.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = checkIngestAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : DEFAULT_LIMIT;
  const limit = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_LIMIT)
    : DEFAULT_LIMIT;

  const sweptCount = sweepStaleLeases(LEASE_TTL_MS);
  const meals = listPendingForRunner(limit);
  return NextResponse.json({ meals, swept: sweptCount, limit });
}
