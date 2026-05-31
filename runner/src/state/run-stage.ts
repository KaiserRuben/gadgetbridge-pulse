/**
 * `runStage` — single ergonomic wrapper for any block of work that should
 * show up in /coach/runner.
 *
 * Combines:
 *   - mint run_id (via run-tracker)
 *   - register row on the Pi (status='running')
 *   - bind run_id into the logger context so descendants inherit it
 *   - emit `start` + `done`/`fail` log lines with elapsed timing
 *   - upsert finish row with elapsed_ms + status + optional error
 *
 * Usage:
 *
 *   await runStage(
 *     { cluster: "v2", key: "2026-05-22", stage: "stage4_prose" },
 *     async () => { ... return result; },
 *   );
 *
 * If `fn` returns a value the wrapper returns it unchanged. If `fn` throws
 * the wrapper logs + records the failure and re-throws. The caller's outer
 * try/catch sees the original error untouched.
 */

import { currentContext, log, withContext } from "../logger.ts";
import { finishRun, mintRunId, startRun, type RunScope } from "./run-tracker.ts";

export interface RunStageOpts {
  cluster: string;
  key: string;
  stage?: string;
  scope?: RunScope;
  attempt?: number;
  meta?: Record<string, unknown>;
  /**
   * Logger tag for the start/done lines. Defaults to `stage ?? cluster`.
   */
  tag?: string;
  /**
   * Emit start/done lines at debug level (off by default). Useful for very
   * chatty sub-stages that don't need a top-line entry.
   */
  silent?: boolean;
}

/**
 * Wrap `fn` as a tracked stage. Returns whatever `fn` returns; on throw,
 * records the run as failed and re-throws.
 */
export async function runStage<T>(opts: RunStageOpts, fn: () => Promise<T>): Promise<T> {
  const parent = currentContext();
  const attempt = opts.attempt ?? 1;
  const runId = mintRunId(opts.cluster, opts.key, attempt);
  const tag = opts.tag ?? opts.stage ?? opts.cluster;

  startRun({
    cluster: opts.cluster,
    key: opts.key,
    scope: opts.scope ?? "daily",
    stage: opts.stage,
    attempt,
    runId,
    parentRunId: parent?.runId,
    meta: opts.meta,
  });

  const t0 = Date.now();
  if (!opts.silent) {
    log.info(tag, `start`);
  } else {
    log.debug(tag, `start`);
  }

  try {
    const result = await withContext({ runId }, () => fn());
    const dt = Date.now() - t0;
    if (!opts.silent) log.info(tag, `done ${dt}ms`);
    else log.debug(tag, `done ${dt}ms`);
    finishRun(runId, { status: "ok" });
    return result;
  } catch (err) {
    const dt = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    log.error(tag, `fail ${dt}ms — ${msg.slice(0, 200)}`);
    finishRun(runId, { status: "fail", error: msg.slice(0, 200) });
    throw err;
  }
}

/**
 * Helper for stage blocks where the caller wants to surface a partial result
 * AND a `fail` marker (e.g. v2 stage4 prose hit critic abstain → returns
 * deterministic stub but pipeline_status='partial').
 */
export async function runStageRecording<T>(
  opts: RunStageOpts,
  fn: () => Promise<{ value: T; ok: boolean; error?: string }>,
): Promise<T> {
  const parent = currentContext();
  const attempt = opts.attempt ?? 1;
  const runId = mintRunId(opts.cluster, opts.key, attempt);
  const tag = opts.tag ?? opts.stage ?? opts.cluster;

  startRun({
    cluster: opts.cluster,
    key: opts.key,
    scope: opts.scope ?? "daily",
    stage: opts.stage,
    attempt,
    runId,
    parentRunId: parent?.runId,
    meta: opts.meta,
  });
  const t0 = Date.now();
  if (!opts.silent) log.info(tag, `start`);

  try {
    const { value, ok, error } = await withContext({ runId }, () => fn());
    const dt = Date.now() - t0;
    if (ok) {
      if (!opts.silent) log.info(tag, `done ${dt}ms`);
      finishRun(runId, { status: "ok" });
    } else {
      log.warn(tag, `partial ${dt}ms — ${(error ?? "unspecified").slice(0, 160)}`);
      finishRun(runId, { status: "fail", error: error?.slice(0, 200) ?? "partial" });
    }
    return value;
  } catch (err) {
    const dt = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    log.error(tag, `fail ${dt}ms — ${msg.slice(0, 200)}`);
    finishRun(runId, { status: "fail", error: msg.slice(0, 200) });
    throw err;
  }
}
