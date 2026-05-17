import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * POST /api/run/[date]
 * Triggers a v3 run for the given date. Spawns runner/src/v3/test/probe-orchestrator.ts
 * detached so the request returns quickly. Status polling via GET /api/run/[date]/status.
 *
 * Body (optional JSON): { live?: boolean }
 *   live=true → packages + day_score only (skip LLM stages).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  let live = false;
  try {
    const body = (await req.json()) as { live?: boolean } | null;
    live = !!body?.live;
  } catch {
    // empty body is fine
  }

  const runnerCwd = path.resolve(process.cwd(), "runner");
  const args = ["tsx", "src/v3/test/probe-orchestrator.ts", "--date", date];
  if (live) args.push("--live");

  const child = spawn("npx", args, {
    cwd: runnerCwd,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  return NextResponse.json({
    ok: true,
    date,
    live,
    pid: child.pid ?? null,
    started_at: new Date().toISOString(),
  });
}
