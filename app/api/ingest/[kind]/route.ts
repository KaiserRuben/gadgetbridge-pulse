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
import {
  createPendingMeal,
  failMeal,
  readMeal,
  writeClassifiedMeal,
  writeFoodCache,
} from "@/lib/data/meal-store";
import type {
  MealComponent,
  MealKind,
  MealSource,
  MealStatus,
  NutritionFacts,
} from "@/lib/nutrition/types";
import { notify as notifyDispatch } from "@/lib/notifications/notifier";
import type { NotifyHint, NotifyIntent, NotifyTopic } from "@/lib/notifications/types";
import { markOrphans, upsertRun, type RunScope, type RunStatus } from "@/lib/data/run-store";
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
      case "notify":
        return handleNotify(body);
      case "run":
        return handleRun(body);
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
  // Piggyback notify: if the runner authored a notify block and the insight
  // landed in a terminal state, fire-and-forget through the notifier.
  // Fire on 'live' and 'complete'; skip 'pending' (no real news yet) and
  // 'partial' (S1 violations etc. — handled by safety_anomaly path instead).
  const hint = parseHint(body.notify);
  if (hint && (status === "live" || status === "complete")) {
    void notifyDispatch({
      topic: hint.topic,
      periodKey,
      hint,
      context: extractInsightContext(body.payload),
    } satisfies NotifyIntent);
  }
  return NextResponse.json({ ok: true });
}

function extractInsightContext(payload: unknown): Record<string, unknown> {
  // The renderer's fallback prose uses fields like `headline`, `next_action`,
  // `rating`. Pull them off the payload root if present so notifications
  // still degrade gracefully when the hint is dropped (length guard etc.).
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  const verdict = (p.verdict ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof verdict.headline === "string") out.headline = verdict.headline;
  if (typeof verdict.next_action === "string") out.next_action = verdict.next_action;
  if (typeof verdict.rating === "string") out.rating = verdict.rating;
  return out;
}

function parseHint(raw: unknown): NotifyHint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const topic = r.topic;
  const title = r.title;
  const body = r.body;
  const url = r.url;
  const dedupeKey = r.dedupeKey;
  if (
    typeof topic !== "string" ||
    typeof title !== "string" ||
    typeof body !== "string" ||
    typeof url !== "string" ||
    typeof dedupeKey !== "string"
  ) {
    return null;
  }
  const allowed: NotifyTopic[] = [
    "meal_classified",
    "day_finalized",
    "sleep_complete",
    "workout_complete",
    "pattern_detected",
    "safety_anomaly",
    "coach_quote",
    "test",
  ];
  if (!allowed.includes(topic as NotifyTopic)) return null;
  return {
    topic: topic as NotifyTopic,
    title,
    body,
    url,
    dedupeKey,
    ttlMinutes: typeof r.ttlMinutes === "number" ? r.ttlMinutes : undefined,
    priority:
      r.priority === "low" || r.priority === "normal" || r.priority === "high"
        ? r.priority
        : undefined,
  };
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
  // Bootstrap path: when the row is missing on this host (e.g. a recovery
  // re-push from another host's pulse.db, or a runner that classified before
  // the Pi knew about the meal), insert a pending row first so the
  // subsequent UPDATE in writeClassifiedMeal hits. Caller must supply the
  // minimum CreatePendingMeal columns. The pending row is immediately
  // overwritten below, so the empty `totals_json` default is fine.
  if (!readMeal(id)) {
    const user_meal_at = body.user_meal_at as string | undefined;
    const period_key = body.period_key as string | undefined;
    const source = body.source as MealSource | undefined;
    if (!user_meal_at || !period_key || !source) {
      return NextResponse.json(
        {
          error:
            "meal row missing on this host; provide user_meal_at, period_key, source to bootstrap",
        },
        { status: 400 },
      );
    }
    try {
      createPendingMeal({
        id,
        user_meal_at,
        period_key,
        photos: photos ?? [],
        user_text: (body.user_text as string | null | undefined) ?? null,
        notes: (body.notes as string | null | undefined) ?? null,
        kind,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: `bootstrap insert failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 500 },
      );
    }
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
  // Notify after a successful classify. Edited meals don't get a push
  // (the user already knows what they edited). Total fields use snake_case
  // because that's what totals is keyed on.
  if (status === "classified") {
    const hint = parseHint(body.notify);
    const primaryName =
      components[0]?.label ?? (kind === "drink" ? "Getränk" : "Mahlzeit");
    const periodKey = classified_at.slice(0, 10);
    void notifyDispatch({
      topic: "meal_classified",
      periodKey,
      hint: hint ?? undefined,
      url: `/log/meal/${id}`,
      dedupeKey: `meal_classified:${id}`,
      context: {
        name: primaryName,
        kcal: totals.kcal,
        protein_g: totals.protein_g,
      },
    } satisfies NotifyIntent);
  }
  return NextResponse.json({ ok: true });
}

async function handleNotify(body: Record<string, unknown>) {
  const periodKey = body.periodKey as string;
  const topic = body.topic as NotifyTopic;
  if (!periodKey || !topic) {
    return NextResponse.json(
      { error: "notify requires periodKey, topic" },
      { status: 400 },
    );
  }
  const intent: NotifyIntent = {
    topic,
    periodKey,
    hint: parseHint(body.hint) ?? undefined,
    context: (body.context as Record<string, unknown>) ?? undefined,
    url: typeof body.url === "string" ? body.url : undefined,
    dedupeKey: typeof body.dedupeKey === "string" ? body.dedupeKey : undefined,
    priority:
      body.priority === "low" || body.priority === "normal" || body.priority === "high"
        ? body.priority
        : undefined,
  };
  // Awaited — for the notify kind the dispatch IS the primary effect.
  // Fire-and-forget would race the idempotency log: a runner retry would
  // see `deduped: true` even when the original dispatch was lost mid-flight.
  // Web-push fanout takes ~100-500ms across N subs; acceptable for the
  // Mac runner's POST round-trip.
  const result = await notifyDispatch(intent);
  return NextResponse.json({ ok: true, result });
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

/**
 * Runner observability ingest. Body carries one of three ops:
 *
 *   op: "upsert"  — write/update a row (start / heartbeat / finish all funnel
 *                   through here; the runner sends a sparse RunUpsertInput so
 *                   COALESCE on the Pi side preserves untouched columns).
 *   op: "orphan"  — boot-time recovery sweep; marks every still-running row
 *                   without a fresh heartbeat as `orphaned`. Returns count.
 *
 * No idempotency-key needed — the run_id itself is the dedupe envelope and
 * upsert is naturally idempotent. The runner POSTs without the header.
 */
function handleRun(body: Record<string, unknown>) {
  const op = (body.op as string) ?? "upsert";
  if (op === "orphan") {
    const olderThanMs = typeof body.olderThanMs === "number" ? body.olderThanMs : 0;
    const swept = markOrphans(olderThanMs);
    return NextResponse.json({ ok: true, swept });
  }
  if (op !== "upsert") {
    return NextResponse.json({ error: `unknown run op: ${op}` }, { status: 400 });
  }
  const run_id = body.run_id as string;
  const cluster = body.cluster as string;
  const key = body.key as string;
  const status = body.status as RunStatus;
  if (!run_id || !cluster || !key || !status) {
    return NextResponse.json(
      { error: "run upsert requires run_id, cluster, key, status" },
      { status: 400 },
    );
  }
  upsertRun({
    run_id,
    cluster,
    key,
    status,
    scope: (body.scope as RunScope) ?? "daily",
    stage: (body.stage as string | null | undefined) ?? null,
    attempt: typeof body.attempt === "number" ? body.attempt : 1,
    started_at: (body.started_at as string | null | undefined) ?? null,
    last_heartbeat_at: (body.last_heartbeat_at as string | null | undefined) ?? null,
    finished_at: (body.finished_at as string | null | undefined) ?? null,
    elapsed_ms: typeof body.elapsed_ms === "number" ? body.elapsed_ms : null,
    prompt_chars: typeof body.prompt_chars === "number" ? body.prompt_chars : null,
    eval_tokens: typeof body.eval_tokens === "number" ? body.eval_tokens : null,
    error_text: (body.error_text as string | null | undefined) ?? null,
    parent_run_id: (body.parent_run_id as string | null | undefined) ?? null,
    meta_json:
      body.meta !== undefined && body.meta !== null
        ? JSON.stringify(body.meta)
        : (body.meta_json as string | null | undefined) ?? null,
    host: (body.host as string | null | undefined) ?? null,
  });
  return NextResponse.json({ ok: true });
}
