import "server-only";
import { NextResponse } from "next/server";

import { clearLlmFoodCache, readFoodCacheStats } from "@/lib/data/meal-store";

export const dynamic = "force-dynamic";

/**
 * GET → seed / llm row counts + newest captured_at.
 * DELETE → drops every LLM-derived row, returns the count removed.
 *
 * Seed rows are never touched here; they come from the USDA snapshot
 * baked into the runner and would just get re-seeded by a fresh import
 * anyway.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json(readFoodCacheStats());
}

export async function DELETE(): Promise<Response> {
  try {
    const removed = clearLlmFoodCache();
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
