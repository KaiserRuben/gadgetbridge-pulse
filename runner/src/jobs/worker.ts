/**
 * Generic JobCell worker.
 *
 * Pops from the in-process queue (and Redis when available), claims the
 * cell, invokes the cluster's `extract → prose` pipeline, releases the
 * cell with payload + provenance (or `error_text` on failure).
 *
 * Concurrency: one worker goroutine. The Ollama mutex in `callOllama`
 * already serialises GPU access, so even multiple workers would queue at
 * that layer — we keep the worker single-slot to keep the queue order
 * predictable end-to-end.
 *
 * Empty-queue policy: 5 s poll. Redis BZPOPMIN would let us block, but
 * the in-process heap can't, and we don't want two different cadences
 * when REDIS_URL flips. The dispatcher tick already wakes us implicitly
 * (it pushes onto the same queue), so 5 s is a sane idle floor.
 */

import { config } from "../config.ts";
import { log } from "../logger.ts";
import { CLUSTER_REGISTRY, type ClusterContext, type ProseContext } from "../clusters/index.ts";
import { claim, release, type Scope } from "./cell.ts";
import { popQueue, type QueueItem } from "./queue.ts";
import { getRedis } from "./redis.ts";
import { readAutoProcessSetting, readCriticEnabled } from "./settings.ts";
import type { ProvenanceTag } from "./types.ts";
import { parseAnomalyInputFromKey } from "../clusters/anomaly_explain/extract.ts";
import { parseWeeklyInputFromKey } from "../clusters/weekly_recap/extract.ts";
import { parseMorningInputFromKey } from "../clusters/morning_insight/extract.ts";
import { parseSynthesisInputFromKey } from "../clusters/synthesis_v3/extract.ts";

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_IDLE_MS = 5000;

/**
 * Dequeue one item, preferring Redis when configured. Falls back to the
 * in-process heap. Returns null when nothing is pending.
 */
async function dequeueOne(): Promise<QueueItem | null> {
  const redis = getRedis();
  if (redis) {
    try {
      // ZPOPMIN returns [member, score] or [] depending on the ioredis API
      // (v5 returns the flat array). We serialise QueueItem to JSON on push,
      // so reverse here.
      const popped = (await redis.zpopmin("pulse:jobs:pending", 1)) as
        | [string, string]
        | string[]
        | null;
      if (popped && Array.isArray(popped) && popped.length >= 1 && typeof popped[0] === "string") {
        const raw = popped[0];
        try {
          return JSON.parse(raw) as QueueItem;
        } catch (err) {
          log.warn("worker", `redis pop: malformed item: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("worker", `redis pop failed, fallback in-process: ${msg}`);
    }
  }
  return popQueue();
}

/**
 * Reconstruct the extract-input for a given cluster + cell key. The
 * registry's base shape doesn't carry per-cluster input schemas; we
 * dispatch off the cluster name and add cases here as new user-triggered
 * clusters land. For auto-process clusters the second arg is unused
 * because their extract derives everything from ctx.
 */
function inputForCluster(cluster: string, key: string): unknown {
  if (cluster === "anomaly_explain") {
    const parsed = parseAnomalyInputFromKey(key);
    if (!parsed) {
      throw new Error(`worker: anomaly_explain key '${key}' unrecognised`);
    }
    return parsed;
  }
  if (cluster === "weekly_recap") {
    const parsed = parseWeeklyInputFromKey(key);
    if (!parsed) {
      throw new Error(`worker: weekly_recap key '${key}' unrecognised (expected YYYY-W##)`);
    }
    return parsed;
  }
  if (cluster === "morning_insight") {
    const parsed = parseMorningInputFromKey(key);
    if (!parsed) {
      throw new Error(
        `worker: morning_insight key '${key}' unrecognised (expected YYYY-MM-DD)`,
      );
    }
    return parsed;
  }
  if (cluster === "synthesis_v3") {
    const parsed = parseSynthesisInputFromKey(key);
    if (!parsed) {
      throw new Error(
        `worker: synthesis_v3 key '${key}' unrecognised (expected YYYY-MM-DD)`,
      );
    }
    return parsed;
  }
  return undefined;
}

/**
 * Run extract + prose for one queue item. Releases the cell either way.
 * Errors flow into release(...errorText) so the dashboard can surface them
 * via the cell's `error` state.
 */
async function runOne(item: QueueItem): Promise<void> {
  const entry = CLUSTER_REGISTRY.get(item.cluster);
  if (!entry) {
    log.warn("worker", `unknown cluster '${item.cluster}', dropping`);
    return;
  }

  const scope: Scope = item.scope ?? "daily";
  const claimed = claim(item.cluster, item.key, DEFAULT_LEASE_MS, scope);
  if (!claimed) {
    // Another worker (or the dashboard route, in theory) already won the
    // race. Skip silently — the winner will release.
    log.info("worker", `claim lost ${item.cluster}/${item.key}`);
    return;
  }

  log.info(
    "worker",
    `start ${item.cluster}/${item.key} prio=${item.priority} reason=${item.reason}`,
  );

  const ctx: ClusterContext = {
    periodKey: item.key,
    tz: config.timezone,
    settings: {
      readAutoProcess: readAutoProcessSetting,
      readCritic: readCriticEnabled,
    },
  };

  let input: unknown;
  try {
    input = inputForCluster(item.cluster, item.key);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("worker", `${item.cluster}/${item.key} input parse: ${msg}`);
    release(item.cluster, item.key, { payload: null, provenance: [] }, msg, scope);
    return;
  }

  let extracted;
  try {
    // Two call shapes coexist: the canonical (ctx) for auto-process clusters
    // and (ctx, input) for user-triggered ones. The base type forbids the
    // second arg so we cast through Function.
    extracted = await (entry.extract as (
      ctx: ClusterContext,
      input?: unknown,
    ) => Promise<unknown>)(ctx, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("worker", `${item.cluster}/${item.key} extract: ${msg}`);
    release(item.cluster, item.key, { payload: null, provenance: [] }, msg, scope);
    return;
  }

  const criticOn = await readCriticEnabled().catch(() => false);
  const proseCtx: ProseContext = {
    ...ctx,
    criticModel: criticOn ? process.env.CRITIC_MODEL ?? "ministral-3:3b" : null,
  };

  let finalPkg;
  try {
    finalPkg = await entry.prose(extracted as never, proseCtx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("worker", `${item.cluster}/${item.key} prose: ${msg}`);
    // Surface partial extract payload so the dashboard still shows context.
    const partial = extracted as { payload?: unknown; provenance?: unknown };
    release(
      item.cluster,
      item.key,
      {
        payload: partial?.payload ?? null,
        provenance: Array.isArray(partial?.provenance)
          ? (partial.provenance as never[])
          : [],
      },
      msg,
      scope,
    );
    return;
  }

  const pkg = finalPkg as {
    payload: unknown;
    provenance: ProvenanceTag[];
  };
  release(
    item.cluster,
    item.key,
    {
      payload: pkg.payload,
      provenance: pkg.provenance ?? [],
    },
    null,
    scope,
  );
  log.info("worker", `done ${item.cluster}/${item.key}`);
}

export interface StartWorkerOpts {
  /** Idle poll interval. Default 5 s. */
  intervalMs?: number;
  /**
   * When true, the worker drains the queue once and exits. Used by tests
   * that want a deterministic step rather than the long-running loop.
   */
  oneShot?: boolean;
}

/**
 * Start the worker loop. Returns a `stop()` function that resolves once
 * the in-flight tick (if any) finishes; queue items pushed after stop()
 * is called are left for the next process. Idempotent — multiple calls
 * return distinct stop handles but share the same underlying queue.
 */
export function startWorker(opts: StartWorkerOpts = {}): () => Promise<void> {
  const intervalMs = opts.intervalMs ?? DEFAULT_IDLE_MS;
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    while (!stopped) {
      const item = await dequeueOne();
      if (!item) break;
      try {
        await runOne(item);
      } catch (err) {
        // runOne already handles per-step errors via release(...err); this
        // catch is a last-resort guard against bugs in the worker itself.
        log.error(
          "worker",
          `runOne crashed for ${item.cluster}/${item.key}: ${(err as Error).message}`,
        );
      }
      if (opts.oneShot) break;
    }
  };

  const loop = async (): Promise<void> => {
    while (!stopped) {
      inFlight = tick();
      await inFlight;
      if (stopped) break;
      if (opts.oneShot) break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };

  log.info("worker", `started intervalMs=${intervalMs}${opts.oneShot ? " (one-shot)" : ""}`);
  // Fire-and-forget; the caller's stop() handle awaits the in-flight tick.
  void loop().catch((err) => {
    log.error("worker", `loop crashed: ${(err as Error).message}`);
  });

  return async () => {
    stopped = true;
    try {
      await inFlight;
    } catch {
      /* already logged in tick */
    }
  };
}

/** Test-only: drain one queue item synchronously. */
export async function _runOneForTests(item: QueueItem): Promise<void> {
  await runOne(item);
}
