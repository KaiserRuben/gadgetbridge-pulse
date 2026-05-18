import { NextResponse } from "next/server";

import { checkIngestAuth } from "@/lib/ingest/auth";
import {
  claimIngestKey,
  writeAlarmEvent,
  writeBundle,
  writeEventLog,
  writeFacts,
  writeInsight,
  writePeriodAtomic,
  writeStateKv,
  type AtomicPeriodWrite,
  type BundleStatus,
  type FactsStatus,
  type InsightStatus,
  type Pipeline,
  type Scope,
} from "@/lib/data/period-store";
import { failMeal, writeClassifiedMeal, writeFoodCache } from "@/lib/data/meal-store";
import type { MealComponent, MealKind, MealStatus, NutritionFacts } from "@/lib/nutrition/types";
export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/[kind]
 *
 * Single ingestion surface for the Mac runner. Body shape varies by kind:
 *
 *   facts:   { periodKey, scope?, status, payload, source? }
 *   insight: { periodKey, scope?, cluster, status, payload, source? }
 *   bundle:  { periodKey, scope?, pipeline?, status, stages, verify? }
 *   alarm:   { id, periodKey, tsIso, kind, severity, payload }
 *   state:   { key, value }
 *   event:   { id, kind, periodKey, tsMs, payload }
 *
 * Auth: Bearer `INGEST_TOKEN` (skipped in dev when no token configured).
 * Idempotency: `Idempotency-Key` header dedupes via PULSE_INGEST_LOG.
 *
 * Writes land in pulse.db; the dashboard re-reads from disk on every
 * request (every page uses `noStore()`), so no event broadcast is needed.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const auth = checkIngestAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const { kind } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const idempotencyKey = req.headers.get("idempotency-key");
  if (idempotencyKey) {
    const claimed = claimIngestKey(
      idempotencyKey,
      kind,
      (body.periodKey as string | undefined) ?? null,
    );
    if (!claimed) {
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  try {
    switch (kind) {
      case "facts":
        return handleFacts(body);
      case "insight":
        return handleInsight(body);
      case "bundle":
        return handleBundle(body);
      case "alarm":
        return handleAlarm(body);
      case "state":
        return handleState(body);
      case "event":
        return handleEvent(body);
      case "period_atomic":
        return handlePeriodAtomic(body);
      case "meal":
        return handleMeal(body);
      case "food":
        return handleFood(body);
      default:
        return NextResponse.json({ error: `unknown kind: ${kind}` }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function asScope(v: unknown): Scope {
  return v === "weekly" ? "weekly" : "daily";
}

function handleFacts(body: Record<string, unknown>) {
  const periodKey = body.periodKey as string;
  const status = body.status as FactsStatus;
  const payload = body.payload;
  if (!periodKey || !status || payload === undefined) {
    return NextResponse.json({ error: "facts requires periodKey, status, payload" }, { status: 400 });
  }
  writeFacts({
    periodKey,
    scope: asScope(body.scope),
    status,
    payload,
    source: (body.source as string) ?? "runner",
  });
  return NextResponse.json({ ok: true });
}

function handleInsight(body: Record<string, unknown>) {
  const periodKey = body.periodKey as string;
  const cluster = body.cluster as string;
  const status = body.status as InsightStatus;
  if (!periodKey || !cluster || !status || body.payload === undefined) {
    return NextResponse.json(
      { error: "insight requires periodKey, cluster, status, payload" },
      { status: 400 },
    );
  }
  writeInsight({
    periodKey,
    scope: asScope(body.scope),
    cluster,
    status,
    payload: body.payload,
    source: (body.source as string) ?? "runner",
    // JobCell columns (M012). Optional; absent on legacy callers, present
    // on cluster-path writes coming through cell.ts release/markStale/claim.
    startedAt: pickNullable(body.startedAt),
    leasedAt: pickNullable(body.leasedAt),
    errorText: pickNullable(body.errorText),
    retries: typeof body.retries === "number" ? body.retries : undefined,
  });
  return NextResponse.json({ ok: true });
}

function pickNullable(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}

function handleBundle(body: Record<string, unknown>) {
  const periodKey = body.periodKey as string;
  const status = body.status as BundleStatus;
  if (!periodKey || !status || body.stages === undefined) {
    return NextResponse.json(
      { error: "bundle requires periodKey, status, stages" },
      { status: 400 },
    );
  }
  writeBundle({
    periodKey,
    scope: asScope(body.scope),
    pipeline: ((body.pipeline as Pipeline) ?? "v2") as Pipeline,
    status,
    stages: body.stages,
    verify: body.verify,
  });
  return NextResponse.json({ ok: true });
}

function handleAlarm(body: Record<string, unknown>) {
  const id = body.id as string;
  const periodKey = body.periodKey as string;
  const tsIso = body.tsIso as string;
  const kind = body.kind as string;
  const severity = body.severity as string;
  if (!id || !periodKey || !tsIso || !kind || !severity) {
    return NextResponse.json(
      { error: "alarm requires id, periodKey, tsIso, kind, severity" },
      { status: 400 },
    );
  }
  writeAlarmEvent({ id, periodKey, tsIso, kind, severity, payload: body.payload ?? null });
  return NextResponse.json({ ok: true });
}

function handleState(body: Record<string, unknown>) {
  const key = body.key as string;
  if (!key) return NextResponse.json({ error: "state requires key" }, { status: 400 });
  writeStateKv(key, body.value);
  return NextResponse.json({ ok: true });
}

function handlePeriodAtomic(body: Record<string, unknown>) {
  const periodKey = body.periodKey as string;
  if (!periodKey) {
    return NextResponse.json({ error: "period_atomic requires periodKey" }, { status: 400 });
  }
  const input: AtomicPeriodWrite = {
    periodKey,
    scope: asScope(body.scope),
    facts: body.facts as AtomicPeriodWrite["facts"],
    insights: body.insights as AtomicPeriodWrite["insights"],
    bundle: body.bundle as AtomicPeriodWrite["bundle"],
  };
  writePeriodAtomic(input);
  return NextResponse.json({ ok: true });
}

function handleMeal(body: Record<string, unknown>) {
  const id = body.id as string;
  const status = body.status as MealStatus;
  if (!id || !status) {
    return NextResponse.json(
      { error: "meal requires id, status" },
      { status: 400 },
    );
  }
  // Terminal failure path: short-circuit straight to PULSE_MEAL row update.
  // We don't need kind/totals/components for a failed meal — those would
  // overwrite the original photo+text-only row with empty values.
  if (status === "failed") {
    const reason = (body.error_reason as string) ?? "unknown";
    try {
      failMeal(id, reason);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  }
  const kind = body.kind as MealKind;
  const classified_at = body.classified_at as string;
  const totals = body.totals as NutritionFacts | undefined;
  const components = body.components as
    | Array<Omit<MealComponent, "id"> & { id?: string }>
    | undefined;
  // Optional: Mac runner sends the new photo_path / photos[] after moving
  // files from inbox/ to photos/. Pass through without mutating when absent.
  const photo_path =
    "photo_path" in body ? ((body.photo_path as string | null) ?? null) : undefined;
  const photos =
    "photos" in body && Array.isArray(body.photos)
      ? (body.photos as Array<{
          path: string;
          mime: string | null;
          kind?: "meal" | "label" | "context" | null;
          captured_at?: string | null;
        }>)
      : undefined;
  if (!kind || !classified_at || !totals || !Array.isArray(components)) {
    return NextResponse.json(
      { error: "meal requires id, status, kind, classified_at, totals, components[]" },
      { status: 400 },
    );
  }
  try {
    writeClassifiedMeal({
      id,
      status,
      kind,
      classified_at,
      totals,
      components,
      photo_path,
      photos,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

function handleFood(body: Record<string, unknown>) {
  const food_key = body.food_key as string;
  const label = (body.label as string | null) ?? null;
  const source = body.source as "llm" | "seed" | "usda" | "off" | "user";
  const model = (body.model as string | null) ?? null;
  const per100g = body.per100g as Record<string, number> | undefined;
  const captured_at = body.captured_at as string;
  const en_query = (body.en_query as string | null | undefined) ?? null;
  if (!food_key || !source || !per100g || !captured_at) {
    return NextResponse.json(
      { error: "food requires food_key, source, per100g, captured_at" },
      { status: 400 },
    );
  }
  if (!["llm", "seed", "usda", "off", "user"].includes(source)) {
    return NextResponse.json(
      { error: "source must be one of llm|seed|usda|off|user" },
      { status: 400 },
    );
  }
  try {
    writeFoodCache({
      food_key,
      label,
      source,
      model,
      per100g: per100g as unknown as NutritionFacts,
      captured_at,
      en_query,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

function handleEvent(body: Record<string, unknown>) {
  const id = body.id as string;
  const kind = body.kind as string;
  const periodKey = body.periodKey as string;
  const tsMs = body.tsMs as number;
  if (!id || !kind || !periodKey || typeof tsMs !== "number") {
    return NextResponse.json(
      { error: "event requires id, kind, periodKey, tsMs" },
      { status: 400 },
    );
  }
  const accepted = writeEventLog({ id, kind, periodKey, tsMs, payload: body.payload ?? null });
  return NextResponse.json({ ok: true, accepted });
}
