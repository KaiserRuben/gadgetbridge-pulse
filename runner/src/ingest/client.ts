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

/**
 * Pi POST default timeout. Previously 5s, which was too tight for a cold
 * Pi route compile and produced steady "This operation was aborted" noise
 * in the JobCell sweep log. 15s catches first-hit JIT comfortably while
 * still aborting genuine hangs.
 */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Read paths (GET /api/nutrition/pending, claim) tolerate cold-start JIT
 *  on the Pi's Next.js routes — 5s aborts a first-hit compile. */
const READ_TIMEOUT_MS = 30_000;

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
  | "food"
  | "notify"
  | "run";

// ── Connectivity-state log dedupe ───────────────────────────────────────────
//
// The Pi (and to a lesser extent host.docker.internal:11434) goes through
// outage windows that previously flooded the log with one warn per tick.
// Each helper that talks to a remote endpoint reports its outcome through
// `noteEndpointResult(endpoint, ok, msg)`; the tracker emits:
//
//   - one `warn` per endpoint when it first goes down
//   - one `warn` per minute as a low-frequency "still down" heartbeat
//   - one `info` when it comes back up, with the outage duration
//
// `endpoint` is a logical name like `pi` or `ollama`, NOT a URL — multiple
// helpers (piCellSweep, fetchPendingMeals, piPatternUpsert) share the same
// state machine so they collectively log a single connectivity narrative.

type Endpoint = "pi" | "ollama";

interface EndpointState {
  up: boolean;
  /** ms since epoch when the current state started. */
  since: number;
  /** Last "still down" log emission. */
  lastDownLog: number;
  /** Last failure message we logged (compared to dedupe identical bursts). */
  lastErrorMsg: string;
}

const DOWN_HEARTBEAT_MS = 60_000;
const endpointState = new Map<Endpoint, EndpointState>();

function getState(endpoint: Endpoint): EndpointState {
  let s = endpointState.get(endpoint);
  if (!s) {
    s = { up: true, since: Date.now(), lastDownLog: 0, lastErrorMsg: "" };
    endpointState.set(endpoint, s);
  }
  return s;
}

function humanDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return `${hr}h`;
}

/**
 * Report a remote-call outcome. Returns the same `ok` value so callers can
 * `return noteEndpointResult(..., result)` ergonomically.
 */
function noteEndpointResult(
  endpoint: Endpoint,
  ok: boolean,
  errorMsg: string = "",
): void {
  const state = getState(endpoint);
  const now = Date.now();
  if (ok) {
    if (!state.up) {
      const downFor = humanDuration(now - state.since);
      log.info("ingest", `${endpoint} reachable again after ${downFor}`);
      state.up = true;
      state.since = now;
      state.lastDownLog = 0;
      state.lastErrorMsg = "";
    }
    return;
  }
  if (state.up) {
    log.warn("ingest", `${endpoint} unreachable — ${errorMsg.slice(0, 160)}`);
    state.up = false;
    state.since = now;
    state.lastDownLog = now;
    state.lastErrorMsg = errorMsg;
    return;
  }
  // Already down. Suppress most lines; emit a heartbeat at most once a
  // minute, and only when the error message changes meaningfully.
  if (now - state.lastDownLog >= DOWN_HEARTBEAT_MS) {
    const downFor = humanDuration(now - state.since);
    log.warn("ingest", `${endpoint} still down for ${downFor} — ${errorMsg.slice(0, 120)}`);
    state.lastDownLog = now;
    state.lastErrorMsg = errorMsg;
  }
}

/** Inspect current endpoint state (for tests + future stat endpoints). */
export function endpointStatus(endpoint: Endpoint): { up: boolean; sinceMs: number } {
  const s = getState(endpoint);
  return { up: s.up, sinceMs: s.since };
}

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
  //
  // The `notify` kind needs special handling: the body contains a `context`
  // map that can drift between retries (e.g. recomputed total_min), which
  // would mint different hashes and bypass the ingest-level dedupe. The
  // notification-level dedupe (PULSE_PUSH_LOG hasRecentDedupe by dedupeKey)
  // already covers application-level "don't push this twice"; the ingest
  // log only needs to swallow exact network retries. So we key the notify
  // ingest exclusively on (kind, topic, dedupeKey ?? periodKey) — drift in
  // unrelated fields can't fragment the dedupe envelope.
  if (kind === "notify") {
    const topic = (body.topic as string) ?? "";
    const dedupeKey = (body.dedupeKey as string) ?? "";
    const periodKey = (body.periodKey as string) ?? "";
    return `notify|${topic}|${dedupeKey || periodKey}`;
  }
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
      noteEndpointResult("pi", false, `HTTP ${res.status}`);
      return {
        ok: false,
        queued: false,
        status: res.status,
        error: `HTTP ${res.status}`,
      };
    }
    noteEndpointResult("pi", true);
    return { ok: true, queued: false, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    noteEndpointResult("pi", false, msg);
    return {
      ok: false,
      queued: false,
      error: msg,
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
    // Telemetry rows (`run` kind) are noisy and the dashboard is fine if a
    // heartbeat drop arrives the next tick — skip the outbox to keep the
    // queue focused on durable writes (facts/insight/bundle/meal).
    if (kind !== "run") enqueue({ kind, body, idemKey });
    return { ...result, queued: kind !== "run" };
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
  /**
   * JobCell columns (PULSE_INSIGHT M012). Forwarded to the Pi so the
   * dashboard's DerivedCell polling sees the same lease/error state the
   * runner just wrote locally. Omit to leave existing Pi values untouched
   * (writeInsight uses COALESCE/NULL semantics).
   */
  startedAt?: string | null;
  leasedAt?: string | null;
  errorText?: string | null;
  retries?: number | null;
  /**
   * Optional notification intent. Authoring is per-cluster: the Stage 4
   * prose pass on the runner side can decide whether to ship a notify
   * block. Pi-side ingest passes this verbatim to the notifier funnel.
   * The renderer's language guard rejects exclamation marks and emoji,
   * so authors must keep the tone observational.
   */
  notify?: PushNotifyHint;
}

/**
 * Inline notify hint shape — keep in lock-step with
 * lib/notifications/types.ts NotifyHint on the Pi side. Both use the
 * same JSON wire format.
 */
export type PushNotifyTopic =
  | "meal_classified"
  | "day_finalized"
  | "sleep_complete"
  | "workout_complete"
  | "pattern_detected"
  | "safety_anomaly"
  | "coach_quote"
  | "test";

export interface PushNotifyHint {
  topic: PushNotifyTopic;
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
  ttlMinutes?: number;
  priority?: "low" | "normal" | "high";
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
    /**
     * Optional Phase 2b provenance tags. Pi stores as
     * `PULSE_MEAL_COMPONENT.provenance_json` (raw JSON-string array). Older
     * runners that don't carry provenance simply omit the field and the Pi
     * persists NULL.
     */
    provenance?: Array<{
      field_path: string;
      source: string;
      external_id?: string;
      captured_at?: string;
      confidence?: number;
    }>;
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
  /**
   * Where the per-100g came from. Phase 2b widens this beyond the original
   * `'llm' | 'seed'` v2 enum to include external authoritative sources
   * (`'usda'`, `'off'`) and explicit manual overrides (`'user'`). The Pi's
   * M013 migration widens the CHECK constraint to match.
   */
  source: "llm" | "seed" | "usda" | "off" | "user";
  model: string | null;
  per100g: Record<string, number>;
  captured_at: string;
  /**
   * The English search term used for USDA / OFF lookups (cached so the
   * ministral translation only runs once per food_key). Persisted on the
   * row even when `source==='llm'` so a later USDA enrichment for the
   * same key can reuse it.
   */
  en_query?: string | null;
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

// ── Notify intent ───────────────────────────────────────────────────────────

export interface PushNotifyInput {
  topic: PushNotifyTopic;
  periodKey: string;
  /** Optional inline LLM-authored notify hint. */
  hint?: PushNotifyHint;
  /** Free-form context for the Pi-side fallback renderer. */
  context?: Record<string, unknown>;
  /** Override the renderer's default deep link. */
  url?: string;
  /** Override the dedupe key (default `{topic}:{periodKey}`). */
  dedupeKey?: string;
  /** Priority bucket: low respects quiet hours strictly; high bypasses. */
  priority?: "low" | "normal" | "high";
}

/**
 * Fire a standalone notification intent at the Pi notifier. Use this for
 * events that don't naturally piggyback on an existing insight/meal/bundle
 * write (e.g. sleep_complete, workout_complete, coach_quote). The Pi's
 * /api/ingest/notify route calls notifier.notify() which runs the full
 * policy gate before any web-push fanout.
 */
export function pushNotify(input: PushNotifyInput): Promise<IngestResult> {
  return send("notify", input as unknown as Record<string, unknown>);
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
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
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
      const msg = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      noteEndpointResult("pi", false, msg);
      return { ok: false, error: msg };
    }
    noteEndpointResult("pi", true);
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    noteEndpointResult("pi", false, msg);
    return { ok: false, error: msg };
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
    // Connectivity state already logged the outage; suppress per-tick warn.
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
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
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

// ── JobCell HTTP wrappers ───────────────────────────────────────────────────
//
// Single-writer architecture: only the Pi mutates pulse.db. The runner's
// cell.ts module is now an HTTP shim that posts each atomic op to the Pi.
// All calls share the bearer token and surface a clean ok/null Result so
// callers don't need to know about Pi availability.

export type CellScope = "daily" | "weekly";
export type CellInsightStatus = "pending" | "live" | "partial" | "complete";
export type CellState = CellInsightStatus | "empty";

export interface CellProvenanceTag {
  source: string;
  detail?: unknown;
}

export interface CellResult {
  cluster: string;
  key: string;
  scope: CellScope;
  state: CellState;
  payload: unknown;
  provenance: CellProvenanceTag[];
  started_at: string | null;
  leased_at: string | null;
  error_text: string | null;
  retries: number;
  updated_at: string;
}

async function piCellPost<T>(
  op: string,
  body: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!config.ingestBaseUrl) return { ok: false, error: "INGEST_BASE_URL empty" };
  const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}/api/jobs/cell/${op}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const msg = `HTTP ${res.status}: ${txt.slice(0, 200)}`;
      noteEndpointResult("pi", false, msg);
      return { ok: false, error: msg };
    }
    noteEndpointResult("pi", true);
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    noteEndpointResult("pi", false, msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function piCellClaim(
  cluster: string,
  key: string,
  scope: CellScope = "daily",
): Promise<CellResult | null> {
  const r = await piCellPost<{ cell: CellResult | null }>("claim", { cluster, key, scope });
  // Outage already surfaced via noteEndpointResult; per-call warn is noise.
  if (!r.ok) return null;
  return r.data.cell;
}

export async function piCellRelease(
  cluster: string,
  key: string,
  payload: unknown,
  provenance: CellProvenanceTag[],
  error: string | null,
  scope: CellScope = "daily",
): Promise<boolean> {
  const r = await piCellPost<{ ok: boolean }>("release", {
    cluster,
    key,
    scope,
    payload,
    provenance,
    error,
  });
  if (!r.ok) return false;
  return r.data.ok;
}

export async function piCellMarkStale(
  cluster: string,
  key: string,
  reason: string,
  scope: CellScope = "daily",
): Promise<boolean> {
  const r = await piCellPost<{ ok: boolean }>("markStale", { cluster, key, scope, reason });
  if (!r.ok) return false;
  return r.data.ok;
}

export async function piCellEnqueuePending(
  cluster: string,
  key: string,
  scope: CellScope = "daily",
): Promise<boolean> {
  const r = await piCellPost<{ ok: boolean }>("enqueue", { cluster, key, scope });
  if (!r.ok) return false;
  return r.data.ok;
}

export async function piCellSweep(ttlMs: number, maxRetries: number): Promise<number> {
  const r = await piCellPost<{ swept: number }>("sweep", { ttlMs, maxRetries });
  if (!r.ok) return 0;
  return r.data.swept;
}

export async function piCellRead(
  cluster: string,
  key: string,
  scope: CellScope = "daily",
): Promise<CellResult | null> {
  const r = await piCellPost<{ cell: CellResult | null }>("read", { cluster, key, scope });
  if (!r.ok) return null;
  return r.data.cell;
}

// ── Pattern library HTTP wrappers ───────────────────────────────────────────

export interface PatternEntry {
  id: string;
  name_de: string;
  description_de: string | null;
  signature_json: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  user_confirmed: boolean;
}

export async function piPatternList(limit = 50): Promise<PatternEntry[]> {
  const r = await piGet<{ patterns: PatternEntry[] }>(`/api/patterns/list?limit=${limit}`);
  if (!r.ok) {
    log.warn("ingest", `piPatternList: ${r.error}`);
    return [];
  }
  return r.data.patterns;
}

export async function piPatternUpsert(
  entry: Omit<PatternEntry, "occurrence_count" | "user_confirmed">,
): Promise<PatternEntry | null> {
  if (!config.ingestBaseUrl) return null;
  const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}/api/patterns/upsert`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
      },
      body: JSON.stringify({ entry }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn("ingest", `piPatternUpsert ${entry.id}: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { pattern: PatternEntry };
    return body.pattern;
  } catch (err) {
    log.warn("ingest", `piPatternUpsert ${entry.id}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bump occurrence_count + last_seen on an existing pattern row. Returns the
 * fresh row, or null when the Pi is unreachable / id is unknown. Use this
 * for "we saw the same cluster again" — `piPatternUpsert` is reserved for
 * truly first-seen patterns (it needs name_de + description_de).
 */
export async function piPatternBump(
  id: string,
  last_seen: string,
): Promise<PatternEntry | null> {
  if (!config.ingestBaseUrl) return null;
  const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}/api/patterns/bump`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
      },
      body: JSON.stringify({ id, last_seen }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { pattern: PatternEntry };
    return body.pattern;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function piPatternConfirm(id: string, name_de?: string): Promise<boolean> {
  if (!config.ingestBaseUrl) return false;
  const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}/api/patterns/confirm`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
      },
      body: JSON.stringify({ id, name_de }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── State-KV read helper ────────────────────────────────────────────────────

export async function piStateKvGet<T = unknown>(key: string): Promise<T | null> {
  const r = await piGet<{ value: T | null }>(`/api/state-kv/${encodeURIComponent(key)}`);
  if (!r.ok) return null;
  return r.data.value;
}

// ── Run telemetry (PULSE_RUN) ───────────────────────────────────────────────
//
// `pushRun` is the only writer for the new runner observability table. It
// piggybacks on /api/ingest/run (the catch-all kind="run" handler on the Pi)
// and bypasses the outbox via the `kind === "run"` clause in `send` — a
// dropped heartbeat is fine, the next one arrives within seconds.

export interface RunUpsertBody {
  op: "upsert";
  run_id: string;
  cluster: string;
  key: string;
  scope?: "daily" | "weekly" | "instant";
  stage?: string | null;
  attempt?: number;
  status: "queued" | "running" | "ok" | "fail" | "orphaned";
  started_at?: string | null;
  last_heartbeat_at?: string | null;
  finished_at?: string | null;
  elapsed_ms?: number | null;
  prompt_chars?: number | null;
  eval_tokens?: number | null;
  error_text?: string | null;
  parent_run_id?: string | null;
  meta?: Record<string, unknown> | null;
  host?: string | null;
}

export interface RunOrphanBody {
  op: "orphan";
  olderThanMs?: number;
}

export type RunBody = RunUpsertBody | RunOrphanBody;

/**
 * POST a run-state row (start/heartbeat/finish/fail/orphan-sweep). Returns
 * the parsed response when available so the orphan-sweep call can read the
 * count. Telemetry-only — failures are silently dropped at the `send` layer.
 */
export async function pushRun(body: RunBody): Promise<{ swept?: number } | null> {
  if (!config.ingestBaseUrl) return null;
  const url = `${config.ingestBaseUrl.replace(/\/+$/, "")}/api/ingest/run`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.ingestToken ? { authorization: `Bearer ${config.ingestToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      noteEndpointResult("pi", false, `HTTP ${res.status}`);
      return null;
    }
    noteEndpointResult("pi", true);
    return (await res.json().catch(() => ({}))) as { swept?: number };
  } catch (err) {
    noteEndpointResult("pi", false, err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
