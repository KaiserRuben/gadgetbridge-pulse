import "server-only";
import { NextResponse } from "next/server";
import path from "node:path";

import { getLandingCandidates } from "@/lib/landing-candidates";
import { getLatestDailyDate } from "@/lib/insights";
import {
  curateLanding,
  type LandingLayout,
} from "@/runner/analyzer/landing-curator.ts";
import {
  readCachedLanding,
  writeCachedLanding,
} from "@/runner/analyzer/landing-cache.ts";

/**
 * GET /api/landing
 *
 * Query: optional `?date=YYYY-MM-DD`. Defaults to the newest folder under
 * `insights/daily/`.
 *
 * Flow:
 *   1. Resolve date.
 *   2. Cache hit → return immediately with `X-Cache: hit`.
 *   3. Compute Stage A candidates (pure compute).
 *   4. Call Stage B curator (one Ollama call, ≤90s).
 *   5. Atomic-write sidecar cache.
 *   6. Return layout JSON.
 *
 * Cache idempotent: re-running for the same date overwrites the file via
 * deterministic seed in the curator, so a forced re-curation costs one
 * additional Ollama call but never produces inconsistent JSON on disk.
 */

export const dynamic = "force-dynamic";

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT =
  process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function localHourBerlin(): number {
  // Best-effort current-hour-of-day in Europe/Berlin without dragging in a
  // full Intl shim. The curator only needs morning/afternoon/evening
  // bucketing, so a few minutes' DST drift is fine.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "12";
  const h = Number(hourPart);
  return Number.isFinite(h) ? h % 24 : 12;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");

  // ── 1. resolve date ──────────────────────────────────────────────
  let date: string | null = null;
  if (dateParam) {
    if (!DATE_RE.test(dateParam)) {
      return NextResponse.json(
        { ok: false, error: "date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    date = dateParam;
  } else {
    date = await getLatestDailyDate();
    if (!date) {
      return NextResponse.json(
        { ok: false, error: "no daily insights found under insights/daily/" },
        { status: 404 },
      );
    }
  }

  // ── 2. cache check ───────────────────────────────────────────────
  const cached = await readCachedLanding(date, INSIGHTS_ROOT);
  if (cached) {
    return NextResponse.json(
      { ok: true, layout: cached, cache: "hit" },
      { headers: { "X-Cache": "hit" } },
    );
  }

  // ── 3. compute candidates ────────────────────────────────────────
  let candidates;
  try {
    candidates = await getLandingCandidates(date);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `candidate compute failed: ${msg}` },
      { status: 500 },
    );
  }
  if (candidates.length === 0) {
    return NextResponse.json(
      { ok: false, error: `no candidates available for ${date}` },
      { status: 404 },
    );
  }

  // ── 4. LLM curate ────────────────────────────────────────────────
  let layout: LandingLayout;
  try {
    layout = await curateLanding(
      candidates,
      { dateKey: date, localHourGuess: localHourBerlin() },
      { ollamaUrl: OLLAMA_URL, timeoutMs: 180_000 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[landing] LLM call failed: ${msg}`);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }

  // ── 5. write cache ───────────────────────────────────────────────
  try {
    await writeCachedLanding(layout, INSIGHTS_ROOT);
  } catch (err) {
    console.error(
      `[landing] cache write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Layout is still valid; return without cache.
  }

  return NextResponse.json(
    { ok: true, layout, cache: "miss" },
    { headers: { "X-Cache": "miss" } },
  );
}
