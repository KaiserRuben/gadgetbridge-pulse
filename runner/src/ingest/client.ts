/**
 * Mac runner → Pi ingest HTTP client.
 *
 * Each helper builds a POST against `config.ingestBaseUrl + /api/ingest/<kind>`,
 * tags it with a deterministic Idempotency-Key, and on failure enqueues the
 * request in the local outbox (see ./outbox.ts) for replay. The runner never
 * blocks the pipeline on Pi availability.
 *
 * When `config.ingestBaseUrl` is empty, every helper is a no-op success. This
 * "offline" mode is allowed (the runner can still write JSON insights to the
 * Syncthing-replicated tree) but it is a deployment footgun for any flow that
 * needs a DB write on the Pi (meals, food cache). We log a loud warning on
 * the first no-op call so the operator notices instead of debugging silently
 * dropped writes.
 */

import { createHash, randomUUID } from "node:crypto";

import { config } from "../config.ts";
import { log } from "../logger.ts";
import { enqueue } from "./outbox.ts";

const DEFAULT_TIMEOUT_MS = 5_000;

let _emptyUrlWarned = false;

export type IngestKind =
  | "facts"
  | "insight"
  | "bundle"
  | "alarm"
  | "state"
  | "event"
  | "period_atomic"
  | "meal"
  | "food";

export interface IngestResult {
  ok: boolean;
  queued: boolean;
  status?: number;
  error?: string;
}

function idempotencyKey(kind: IngestKind, body: Record<string, unknown>): string {
  // Stable per (kind, periodKey, cluster, status, key, payload-hash) so
  // retries dedupe but distinct payloads collide-free. The `key` field is
  // critical for `state` kind: two state keys with the same JSON-equal
  // value (e.g. both `null`) would otherwise share a key and one would be
  // silently swallowed by PULSE_INGEST_LOG.
  const periodKey = (body.periodKey as string) ?? "";
  const cluster = (body.cluster as string) ?? "";
  const status = (body.status as string) ?? "";
  const stateKey = (body.key as string) ?? "";
  const payloadStr = JSON.stringify(body.payload ?? body.stages ?? body.value ?? body);
  const hash = createHash("sha1").update(payloadStr).digest("hex").slice(0, 12);
  return `${kind}|${periodKey}|${cluster}|${status}|${stateKey}|${hash}`;
}

async function doPost(
  kind: IngestKind,
  body: Record<string, unknown>,
  idemKey: string,
): Promise<IngestResult> {
  if (!config.ingestBaseUrl) {
    if (!_emptyUrlWarned) {
      log.warn(
        "ingest",
        "INGEST_BASE_URL is empty — all Pi writes will be silent no-ops. " +
          "Meals will never reach pulse.db, food cache will never persist, and " +
          "insight POSTs will be dropped. Set INGEST_BASE_URL to the Pi's URL " +
          "(e.g. http://pulse.tailnet:3030) in the runner env to enable writes.",
      );
      _emptyUrlWarned = true;
    }
    return { ok: true, queued: false };
  }
  const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}/api/ingest/${kind}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idemKey,
        ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        queued: false,
        status: res.status,
        error: `HTTP ${res.status}`,
      };
    }
    return { ok: true, queued: false, status: res.status };
  } catch (err) {
    return {
      ok: false,
      queued: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function send(
  kind: IngestKind,
  body: Record<string, unknown>,
): Promise<IngestResult> {
  if (!config.ingestBaseUrl) return { ok: true, queued: false };
  const idemKey = idempotencyKey(kind, body);
  const result = await doPost(kind, body, idemKey);
  if (!result.ok) {
    enqueue({ kind, body, idemKey });
    return { ...result, queued: true };
  }
  return result;
}

// ── Typed wrappers ───────────────────────────────────────────────────────────

export interface PushFactsInput {
  periodKey: string;
  scope?: "daily" | "weekly";
  status: "live" | "locked";
  payload: unknown;
  source?: string;
}

export function pushFacts(input: PushFactsInput): Promise<IngestResult> {
  return send("facts", input as unknown as Record<string, unknown>);
}

export interface PushInsightInput {
  periodKey: string;
  scope?: "daily" | "weekly";
  cluster: string;
  status: "pending" | "live" | "partial" | "complete";
  payload: unknown;
  source?: string;
}

export function pushInsight(input: PushInsightInput): Promise<IngestResult> {
  return send("insight", input as unknown as Record<string, unknown>);
}

export interface PushBundleInput {
  periodKey: string;
  scope?: "daily" | "weekly";
  pipeline?: "v2" | "v3";
  status: "pending" | "live" | "partial" | "complete";
  stages: unknown;
  verify?: unknown;
}

export function pushBundle(input: PushBundleInput): Promise<IngestResult> {
  return send("bundle", input as unknown as Record<string, unknown>);
}

export interface PushAlarmInput {
  id: string;
  periodKey: string;
  tsIso: string;
  kind: string;
  severity: string;
  payload: unknown;
}

export function pushAlarm(input: PushAlarmInput): Promise<IngestResult> {
  return send("alarm", input as unknown as Record<string, unknown>);
}

export interface PushStateInput {
  key: string;
  value: unknown;
}

export function pushState(input: PushStateInput): Promise<IngestResult> {
  return send("state", input as unknown as Record<string, unknown>);
}

export interface PushEventInput {
  id?: string;
  kind: string;
  periodKey: string;
  tsMs: number;
  payload: unknown;
}

export function pushEvent(input: PushEventInput): Promise<IngestResult> {
  const id = input.id ?? randomUUID();
  return send("event", { ...input, id } as Record<string, unknown>);
}

export interface PushPeriodAtomicInput {
  periodKey: string;
  scope?: "daily" | "weekly";
  facts?: { status: "live" | "locked"; payload: unknown; source?: string };
  insights?: Array<{
    cluster: string;
    status: "pending" | "live" | "partial" | "complete";
    payload: unknown;
    source?: string;
  }>;
  bundle?: {
    pipeline?: "v2" | "v3";
    status: "pending" | "live" | "partial" | "complete";
    stages: unknown;
    verify?: unknown;
  };
}

/**
 * Atomic write: facts + insight(s) + bundle in one round-trip and one
 * SQLite transaction on the Pi. Use at pipeline finalize when you'd
 * otherwise call pushFacts + pushInsight + pushBundle sequentially —
 * avoids the SSE-refresh window where the dashboard could read locked
 * facts paired with a stale insight.
 */
export function pushPeriodAtomic(input: PushPeriodAtomicInput): Promise<IngestResult> {
  return send("period_atomic", input as unknown as Record<string, unknown>);
}

export interface PushMealInput {
  id: string;
  status: "classified" | "edited" | "failed";
  kind: "breakfast" | "lunch" | "dinner" | "snack" | "drink";
  classified_at: string;
  totals: Record<string, number>;
  /**
   * Terminal failure reason. Required when `status='failed'`, ignored
   * otherwise. The Pi truncates to 500 chars before persisting.
   */
  error_reason?: string;
  components: Array<{
    ord?: number;
    food_key: string;
    label: string;
    grams: number;
    confidence: number | null;
    source: "vlm" | "user_edit" | "user_add" | "user_text";
    nutrition: { per100g: Record<string, number>; totals: Record<string, number> };
  }>;
  /**
   * New cover photo path (relative to mealsRoot) after the runner moved the
   * file from inbox/ to photos/. Mirrors photos[0].path when photos[] is
   * also sent. Omit to leave the Pi's stored path untouched.
   */
  photo_path?: string | null;
  /**
   * Full ordered photo list with the post-move (photos/) paths. When omitted
   * the Pi leaves the existing PULSE_MEAL_PHOTO rows untouched; when present
   * it wholesale-replaces them.
   */
  photos?: Array<{
    path: string;
    mime: string | null;
    kind?: "meal" | "label" | "context" | null;
    captured_at?: string | null;
  }>;
}

export function pushMeal(input: PushMealInput): Promise<IngestResult> {
  return send("meal", input as unknown as Record<string, unknown>);
}

export interface PushFoodInput {
  food_key: string;
  label: string | null;
  source: "llm" | "seed";
  model: string | null;
  per100g: Record<string, number>;
  captured_at: string;
}

/**
 * Persist an LLM-derived per-100g nutrition entry to PULSE_FOOD_NUTRITION on
 * the Pi. Returning `queued` means the Pi was unreachable — the Mac runner
 * keeps the value in-process for the rest of the run; the next run will hit
 * the LLM again until a successful replay lands the row.
 */
export function pushFood(input: PushFoodInput): Promise<IngestResult> {
  return send("food", input as unknown as Record<string, unknown>);
}

// ── Pi → Mac read helpers ────────────────────────────────────────────────────
//
// These call the Pi dashboard's read routes (NOT /api/ingest/*) so the Mac
// runner can pull queue state without sharing a DB handle over Syncthing.
// Like the push helpers they share the bearer token via PULSE_INGEST_TOKEN
// and degrade to "Pi unreachable" without crashing the runner.

export interface PendingMealPhotoDTO {
  ord: number;
  path: string;
  mime: string | null;
  kind: "meal" | "label" | "context" | null;
}

export interface PendingMealDTO {
  meal_id: string;
  period_key: string;
  user_meal_at: string;
  user_text: string | null;
  notes: string | null;
  /** Non-null = a runner has it leased ("processing"). */
  leased_at: string | null;
  photos: PendingMealPhotoDTO[];
}

interface PendingResponse {
  meals: PendingMealDTO[];
  swept: number;
  limit: number;
}

async function piGet<T>(pathAndQuery: string): Promise<
  { ok: true; data: T } | { ok: false; error: string }
> {
  if (!config.ingestBaseUrl) {
    return { ok: false, error: "INGEST_BASE_URL empty" };
  }
  const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}${pathAndQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the next batch of meals to classify. Side-effect on the Pi: stale
 * leases get swept before the list is returned (see GET /api/nutrition/pending).
 */
export async function fetchPendingMeals(limit = 16): Promise<PendingMealDTO[]> {
  const r = await piGet<PendingResponse>(`/api/nutrition/pending?limit=${limit}`);
  if (!r.ok) {
    log.warn("ingest", `fetchPendingMeals: ${r.error}`);
    return [];
  }
  if (r.data.swept > 0) {
    log.warn("ingest", `Pi swept ${r.data.swept} stale lease(s)`);
  }
  return r.data.meals;
}

export interface ClaimResult {
  ok: boolean;
  reason?: string;
  meal?: PendingMealDTO;
}

/**
 * Atomic pending→processing transition on the Pi. Returns ok=true only when
 * THIS caller now owns the meal — anything else (already claimed, deleted,
 * Pi unreachable) returns ok=false with a reason string so the reconciler
 * can pick the next one without spinning.
 */
export async function claimMeal(mealId: string): Promise<ClaimResult> {
  if (!config.ingestBaseUrl) return { ok: false, reason: "ingest_url_empty" };
  const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}/api/nutrition/claim`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
      },
      body: JSON.stringify({ meal_id: mealId }),
      signal: controller.signal,
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      return { ok: false, reason: body.reason ?? "conflict" };
    }
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { ok: boolean; meal: PendingMealDTO };
    return { ok: body.ok, meal: body.meal };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
