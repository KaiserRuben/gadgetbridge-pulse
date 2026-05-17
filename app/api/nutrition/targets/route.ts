import "server-only";
import { NextResponse } from "next/server";

import { readStateKv, writeStateKv } from "@/lib/data/period-store";
import { DEFAULT_TARGETS } from "@/lib/nutrition/helpers";
import type { NutritionTargets } from "@/lib/nutrition/types";

export const dynamic = "force-dynamic";

/**
 * GET → current targets blob (stored override OR DEFAULT_TARGETS).
 * PATCH { key: string, target: number | null } → update a single row's
 *   override. `null` removes the override (effective value falls back to
 *   default_target). Returns the new blob so the client can re-render
 *   without a follow-up GET.
 *
 * Whole-blob writes intentionally not exposed — keeps the editor surface
 * narrow and avoids "client sent stale rows" foot-guns.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json(loadTargets());
}

interface PatchBody {
  key?: unknown;
  target?: unknown;
}

export async function PATCH(req: Request): Promise<Response> {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key : null;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const newTarget =
    body.target === null
      ? null
      : typeof body.target === "number" && Number.isFinite(body.target)
      ? Math.max(0, body.target)
      : null;

  const current = loadTargets();
  const idx = current.rows.findIndex((r) => r.key === key);
  if (idx < 0) {
    return NextResponse.json({ error: `unknown nutrient key: ${key}` }, { status: 404 });
  }
  const next: NutritionTargets = {
    updated_at: new Date().toISOString(),
    rows: current.rows.map((r, i) =>
      i === idx ? { ...r, target: newTarget } : r,
    ),
  };
  try {
    writeStateKv("nutrition_targets", next);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  return NextResponse.json(next);
}

/**
 * DELETE → drops the stored override, so getTargets() falls back to
 * DEFAULT_TARGETS on next read. Used by the "Alle Standards" button.
 */
export async function DELETE(): Promise<Response> {
  try {
    // writeStateKv with `null` value clears the row (period-store
    // serialises JSON; null is the canonical "no value" marker).
    writeStateKv("nutrition_targets", null);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, targets: DEFAULT_TARGETS });
}

function loadTargets(): NutritionTargets {
  const stored = readStateKv<NutritionTargets>("nutrition_targets");
  if (stored && Array.isArray(stored.rows)) return stored;
  return DEFAULT_TARGETS;
}
