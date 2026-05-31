/**
 * Runner-side run tracker.
 *
 * Holds an in-memory map of every currently-active "run" (a cluster
 * execution, a stage, a single Ollama call). Each transition (start /
 * heartbeat / finish / fail) writes back to the Pi via /api/ingest/run so
 * the dashboard's `/coach/runner` panel can show what is happening NOW.
 *
 * The Pi POST is best-effort: failures are queued via the existing ingest
 * outbox so a Pi-unreachable window doesn't lose telemetry. We never block
 * the pipeline on the Pi being up — telemetry must never gate work.
 *
 * Persistence:
 *   - In-memory map survives the process lifetime only.
 *   - A snapshot is mirrored to /runner-state/runs.json on every transition
 *     (debounced via 1 s timer) so the boot path can identify rows that the
 *     previous container left in `running` and mark them orphaned via the
 *     Pi sweep op.
 *
 * Concurrency: the map is mutated from many AsyncLocalStorage scopes. The
 * mutex is implicit (single Node thread); ordering is observed by the Pi as
 * well because each POST is fire-and-forget via the outbox, so we accept
 * occasional reordering of distinct run rows.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { hostname } from "node:os";

import { log } from "../logger.ts";
import { pushRun } from "../ingest/client.ts";

export type RunStatus = "queued" | "running" | "ok" | "fail" | "orphaned";
export type RunScope = "daily" | "weekly" | "instant";

export interface RunInfo {
  run_id: string;
  cluster: string;
  key: string;
  scope: RunScope;
  stage?: string;
  attempt: number;
  parent_run_id?: string;
  started_at_ms: number;
  last_heartbeat_ms: number;
  prompt_chars?: number;
  eval_tokens?: number;
  meta?: Record<string, unknown>;
}

const SNAPSHOT_PATH = process.env.PULSE_RUN_SNAPSHOT_PATH ?? "/runner-state/runs.json";
const SNAPSHOT_DEBOUNCE_MS = 1_000;
const HOST = process.env.PULSE_RUNNER_HOST ?? hostname();

const active = new Map<string, RunInfo>();
let snapshotTimer: NodeJS.Timeout | null = null;

function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 6);
}

/**
 * Mint a deterministic run id from (cluster, key, attempt, t0). The hash
 * suffix breaks ties when the same triple runs twice in one ms (e.g.
 * heartbeat + retry on a fast loop). Format kept human-greppable.
 */
export function mintRunId(
  cluster: string,
  key: string,
  attempt: number,
  startedAtMs: number = Date.now(),
): string {
  const tag = `${cluster}|${key}|${attempt}|${startedAtMs}|${randomUUID()}`;
  return `${cluster}:${key}:${attempt}:${shortHash(tag)}`;
}

function scheduleSnapshot(): void {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void writeSnapshot();
  }, SNAPSHOT_DEBOUNCE_MS);
}

async function writeSnapshot(): Promise<void> {
  try {
    await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
    const payload = {
      host: HOST,
      written_at: new Date().toISOString(),
      active: Array.from(active.values()),
    };
    const tmp = `${SNAPSHOT_PATH}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    // atomic-ish: rename overwrites the target on POSIX.
    await rename(tmp, SNAPSHOT_PATH);
  } catch (err) {
    // Snapshot is best-effort. If /runner-state isn't mounted (probe
    // scripts running outside docker), silently drop.
    log.debug("run-tracker", `snapshot write skipped: ${(err as Error).message}`);
  }
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

export interface StartRunOpts {
  cluster: string;
  key: string;
  scope?: RunScope;
  stage?: string;
  attempt?: number;
  parentRunId?: string;
  meta?: Record<string, unknown>;
  /** Allow callers (e.g. `runStage`) to provide a pre-minted id. */
  runId?: string;
}

export function startRun(opts: StartRunOpts): RunInfo {
  const now = Date.now();
  const info: RunInfo = {
    run_id: opts.runId ?? mintRunId(opts.cluster, opts.key, opts.attempt ?? 1, now),
    cluster: opts.cluster,
    key: opts.key,
    scope: opts.scope ?? "daily",
    stage: opts.stage,
    attempt: opts.attempt ?? 1,
    parent_run_id: opts.parentRunId,
    started_at_ms: now,
    last_heartbeat_ms: now,
    meta: opts.meta,
  };
  active.set(info.run_id, info);
  scheduleSnapshot();
  void pushRun({
    op: "upsert",
    run_id: info.run_id,
    cluster: info.cluster,
    key: info.key,
    scope: info.scope,
    stage: info.stage ?? null,
    attempt: info.attempt,
    status: "running",
    started_at: isoFromMs(info.started_at_ms),
    last_heartbeat_at: isoFromMs(info.last_heartbeat_ms),
    parent_run_id: info.parent_run_id ?? null,
    meta: info.meta ?? null,
    host: HOST,
  });
  return info;
}

export function heartbeat(
  run_id: string,
  patch?: Partial<Pick<RunInfo, "prompt_chars" | "eval_tokens" | "stage">>,
): void {
  const info = active.get(run_id);
  if (!info) return;
  const now = Date.now();
  info.last_heartbeat_ms = now;
  if (patch?.prompt_chars !== undefined) info.prompt_chars = patch.prompt_chars;
  if (patch?.eval_tokens !== undefined) info.eval_tokens = patch.eval_tokens;
  if (patch?.stage !== undefined) info.stage = patch.stage;
  scheduleSnapshot();
  // Heartbeat carries the FULL run state — not just the heartbeat timestamp.
  // Telemetry POSTs for `run` kind bypass the durable outbox, so a missed
  // start (Pi briefly unreachable when the run began) would otherwise leave
  // the Pi row in a half-state with NULL `started_at` and no parent link
  // forever. Sending everything every 30 s makes the upsert idempotent and
  // self-heals after the connectivity blip.
  void pushRun({
    op: "upsert",
    run_id,
    cluster: info.cluster,
    key: info.key,
    scope: info.scope,
    stage: info.stage ?? null,
    attempt: info.attempt,
    status: "running",
    started_at: isoFromMs(info.started_at_ms),
    last_heartbeat_at: isoFromMs(now),
    prompt_chars: info.prompt_chars ?? null,
    eval_tokens: info.eval_tokens ?? null,
    parent_run_id: info.parent_run_id ?? null,
    meta: info.meta ?? null,
    host: HOST,
  });
}

export interface FinishRunInput {
  status: "ok" | "fail";
  error?: string | null;
  prompt_chars?: number;
  eval_tokens?: number;
  meta?: Record<string, unknown>;
}

export function finishRun(run_id: string, input: FinishRunInput): RunInfo | null {
  const info = active.get(run_id);
  if (!info) return null;
  const now = Date.now();
  active.delete(run_id);
  scheduleSnapshot();
  const elapsed = now - info.started_at_ms;
  void pushRun({
    op: "upsert",
    run_id,
    cluster: info.cluster,
    key: info.key,
    scope: info.scope,
    stage: info.stage ?? null,
    attempt: info.attempt,
    status: input.status,
    started_at: isoFromMs(info.started_at_ms),
    last_heartbeat_at: isoFromMs(now),
    finished_at: isoFromMs(now),
    elapsed_ms: elapsed,
    prompt_chars: input.prompt_chars ?? info.prompt_chars ?? null,
    eval_tokens: input.eval_tokens ?? info.eval_tokens ?? null,
    error_text: input.error ?? null,
    meta: input.meta ?? info.meta ?? null,
  });
  return info;
}

/** Snapshot accessor (read-only) for the queue-snapshot logger + tests. */
export function listActive(): RunInfo[] {
  return Array.from(active.values());
}

/**
 * Boot-time recovery hook. Asks the Pi to mark every still-`running` row as
 * `orphaned`. The Pi-side sweep enforces a cutoff so heartbeats from the
 * fresh process (already coming in) survive. Returns the count for the
 * banner.
 */
export async function markOrphans(olderThanMs: number = 60_000): Promise<number> {
  const r = await pushRun({ op: "orphan", olderThanMs });
  return r?.swept ?? 0;
}

/** Test/probe affordance: clear the in-memory map. */
export function _reset(): void {
  active.clear();
}

/** Path of the on-disk snapshot mirror — exported for the probe scripts. */
export function snapshotPath(): string {
  return SNAPSHOT_PATH;
}
