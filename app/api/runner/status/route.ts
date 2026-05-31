import { NextResponse } from "next/server";

import { clusterStats, listInFlight, listRecent } from "@/lib/data/run-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/runner/status
 *
 * Live snapshot of the Mac runner observability surface (PULSE_RUN).
 *
 *   in_flight: rows the runner is actively executing right now (status in
 *              {queued, running}). Includes elapsed_ms derived from
 *              started_at so the dashboard can drive a progress bar without
 *              having to do clock math client-side.
 *   recent:    last N rows that finished (ok / fail / orphaned), newest
 *              first. Caps at `limit` (default 20).
 *   failures:  same shape as recent but only status='fail' or 'orphaned'.
 *              Lets the dashboard's "Last failures" strip surface persistent
 *              problems without scrolling through OK rows.
 *   stats:     per-cluster {count, ok_count, fail_count, p50_ms, p95_ms,
 *              max_ms} over the last 50 finished runs per cluster. The
 *              dashboard uses p95 as the progress-bar denominator so a
 *              live run shows "running for 12m, p95 is 18m".
 *
 * Polling is the default access pattern (the dashboard uses a 5s interval);
 * we don't ship SSE here because the in-flight set rarely exceeds 3 rows
 * and the polling pressure is trivial.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = clamp(Number(url.searchParams.get("limit") ?? 20), 1, 200);
  try {
    const inFlight = listInFlight().map(decorate);
    const recent = listRecent(limit);
    const failures = listRecent(limit, "fail");
    const stats = clusterStats(50);
    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      in_flight: inFlight,
      recent,
      failures,
      stats,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

interface DecoratedRun {
  run_id: string;
  cluster: string;
  key: string;
  scope: string;
  stage: string | null;
  attempt: number;
  status: string;
  started_at: string | null;
  last_heartbeat_at: string | null;
  /** ms since started_at; null if started_at is null. */
  elapsed_ms_live: number | null;
  /** ms since last_heartbeat_at; helps flag stalled runs. */
  silence_ms: number | null;
  prompt_chars: number | null;
  eval_tokens: number | null;
  error_text: string | null;
  parent_run_id: string | null;
}

function decorate(row: ReturnType<typeof listInFlight>[number]): DecoratedRun {
  const now = Date.now();
  const startedMs = row.started_at ? Date.parse(row.started_at) : NaN;
  const hbMs = row.last_heartbeat_at ? Date.parse(row.last_heartbeat_at) : NaN;
  return {
    run_id: row.run_id,
    cluster: row.cluster,
    key: row.key,
    scope: row.scope,
    stage: row.stage,
    attempt: row.attempt,
    status: row.status,
    started_at: row.started_at,
    last_heartbeat_at: row.last_heartbeat_at,
    elapsed_ms_live: Number.isFinite(startedMs) ? now - startedMs : null,
    silence_ms: Number.isFinite(hbMs) ? now - hbMs : null,
    prompt_chars: row.prompt_chars,
    eval_tokens: row.eval_tokens,
    error_text: row.error_text,
    parent_run_id: row.parent_run_id,
  };
}
