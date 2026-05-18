import { NextResponse } from "next/server";

import { enqueue } from "@/runner/jobs/cell";
import { writeMarker } from "@/runner/jobs/queue-marker";
import { JobPriority } from "@/runner/jobs/types";
import type { Scope } from "@/lib/data/period-store";

export const dynamic = "force-dynamic";

const SCOPES: readonly Scope[] = ["daily", "weekly"];

/**
 * User-triggered reprocess. Two-step bridge for the Pi-dashboard / Mac-
 * runner split:
 *
 *   1. `enqueue()` writes `PULSE_INSIGHT` (Pi's pulse.db) and pushes onto
 *      the Pi-side in-process queue. The DB write is what the dashboard's
 *      DerivedCell polling reads to flip to "reprocessing".
 *   2. `writeMarker()` drops a tiny file in `$INSIGHTS_ROOT/queue/`.
 *      Syncthing replicates it to the Mac (~1–5s), where the runner's
 *      event-loop drains the queue dir and re-enqueues locally so the
 *      Ollama worker actually picks up the job.
 *
 * Without (2) the click only writes Pi state — the Mac queue never sees
 * the request and the cluster never runs.
 *
 * Both writes are best-effort; the response reports the *intent*, not
 * end-to-end completion (the client polls for status anyway).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ cluster: string; key: string }> },
) {
  const { cluster, key } = await params;
  const scope = (new URL(req.url).searchParams.get("scope") ?? "daily") as Scope;
  if (!SCOPES.includes(scope)) {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }
  try {
    await enqueue({
      cluster,
      key,
      scope,
      priority: JobPriority.UserRequested,
      reason: "user_requested",
    });
    // Bridge: tell the Mac runner there's work. Failure here doesn't undo
    // the Pi-side enqueue (the dashboard still flips to "reprocessing"),
    // but the cluster won't run until the marker lands — surface the
    // error so /settings/clusters can show it.
    await writeMarker({
      cluster,
      key,
      scope,
      priority: JobPriority.UserRequested,
      reason: "user_requested",
    });
    return NextResponse.json({ queued: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { queued: false, error: msg },
      { status: 500 },
    );
  }
}
