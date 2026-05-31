import { randomUUID } from "node:crypto";

import { Agent, fetch as undiciFetch } from "undici";
import { config } from "./config.ts";
import { getRedis } from "./jobs/redis.ts";
import { log, withContext, currentContext } from "./logger.ts";
import {
  finishRun,
  heartbeat as runHeartbeat,
  mintRunId,
  startRun,
} from "./state/run-tracker.ts";

/**
 * Long-inference dispatcher. Default Node fetch (undici) caps body timeout at
 * 5 min; qwen3.6 cold-load + generation can exceed that. Disable timeouts.
 */
const longRunDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
});

/**
 * Default budget for the remote-host probe. The remote endpoint is "best
 * effort" (off-network, may be unreachable). 3s lets us fall through to the
 * local instance quickly without burning user-perceived latency.
 */
const REMOTE_PROBE_TIMEOUT_MS = 3_000;

export type OllamaCallParams = {
  model: string;
  system: string;
  user: string;
  format: unknown;
  options?: Record<string, unknown>;
  /**
   * If set, overrides config.ollamaUrl for this call (e.g. forcing a
   * specific local instance from a probe script). Independent of the
   * OLLAMA_REMOTE_URL fallback.
   */
  baseUrl?: string;
  /**
   * Try the OLLAMA_REMOTE_URL endpoint first with a short timeout, fall
   * back to the local URL on failure. Off by default — only the chart
   * route opts in (cf. `app/api/chart/route.ts`).
   */
  preferRemote?: boolean;
  /** Override the remote-probe timeout. Default 3000ms. */
  remoteTimeoutMs?: number;
  /**
   * Short identifier for the call site (e.g. "stage4_prose", "v3:sleep",
   * "coaching:steps_daily"). Logged at start + end so docker logs show
   * which LLM call is currently running and what it produced.
   */
  tag?: string;
};

export type OllamaResult = {
  content: string;
  thinking?: string;
  totalMs: number;
  promptTokens: number;
  evalTokens: number;
  /**
   * Ollama termination reason: "stop" (natural EOS), "length" (hit num_predict
   * cap — often means content empty when thinking ate the budget), "load" or
   * other status strings. Surface in logs so empty-content failures are
   * obvious without re-reading prompts.
   */
  doneReason?: string;
  /** Which endpoint actually served the response. */
  endpoint: "remote" | "local";
  /** Resolved URL used for the successful call (debug surface). */
  endpointUrl: string;
};

// ── Global single-slot GPU mutex ────────────────────────────────────────────
//
// Ollama itself serialises generation per-process, but the runner can issue
// concurrent callOllama() invocations from independent code paths (stage
// pipeline + on-demand chart route + meal classifier). The in-process
// promise chain `gpuSlot` enforces FIFO serialisation across all of them.
//
// If Redis is reachable, we additionally hold `pulse:ollama:slot` with a
// 600s TTL so a second runner instance (Mac + Pi co-processing) coordinates
// across processes. A 30s refresh interval extends the lease so long
// generations don't lose it. Fail-open: any Redis error falls back to
// in-process-only.

const REDIS_LOCK_KEY = "pulse:ollama:slot";
const REDIS_LOCK_TTL_SEC = 600;
const REDIS_LOCK_REFRESH_MS = 30_000;

let gpuSlot: Promise<unknown> = Promise.resolve();

async function acquireRedisSlot(): Promise<{ owner: string; refresh: NodeJS.Timeout | null } | null> {
  const redis = getRedis();
  if (!redis) return null;
  const owner = randomUUID();
  try {
    // SET NX EX gives an atomic "create-or-fail" lock. We retry-on-busy with
    // a short sleep loop bounded by the in-process gpuSlot serialisation —
    // by the time we reach here, the in-process mutex already holds the
    // call site exclusive on this runner.
    const start = Date.now();
    while (true) {
      const ok = await redis.set(REDIS_LOCK_KEY, owner, "NX", "EX", REDIS_LOCK_TTL_SEC);
      if (ok === "OK" || ok === 1 || ok === true) break;
      if (Date.now() - start > REDIS_LOCK_TTL_SEC * 1000) {
        log.warn("llm", `redis ollama lock wait > ${REDIS_LOCK_TTL_SEC}s — proceeding without lock`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const refresh = setInterval(() => {
      void (async () => {
        try {
          await redis.expire(REDIS_LOCK_KEY, REDIS_LOCK_TTL_SEC);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn("llm", `redis lock refresh failed: ${msg}`);
        }
      })();
    }, REDIS_LOCK_REFRESH_MS);
    return { owner, refresh };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("llm", `redis ollama lock acquire failed: ${msg}`);
    return null;
  }
}

const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

async function releaseRedisSlot(handle: { owner: string; refresh: NodeJS.Timeout | null } | null): Promise<void> {
  if (!handle) return;
  if (handle.refresh) clearInterval(handle.refresh);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.eval(RELEASE_LUA, 1, REDIS_LOCK_KEY, handle.owner);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("llm", `redis ollama lock release failed: ${msg}`);
  }
}

/** Resolve the configured remote URL, normalised (trailing slash stripped). */
export function getRemoteOllamaUrl(): string | null {
  const raw = process.env.OLLAMA_REMOTE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * POST to Ollama /api/chat. Returns the assistant content + telemetry.
 * Does NOT parse content as JSON; caller decides.
 *
 * If `preferRemote` is set and OLLAMA_REMOTE_URL is configured, the call
 * races a short-timeout probe against the remote host first and falls
 * back to the local instance on any error (timeout, 5xx, ECONNREFUSED).
 * Useful for the on-demand chart route where the user is waiting.
 *
 * Concurrency: a process-wide `gpuSlot` promise chain serialises every
 * callOllama invocation. Concurrent callers see the chain extend; their
 * actual POSTs run one-at-a-time. When Redis is configured, an additional
 * cross-process lock prevents two runner instances from racing the same
 * single-GPU Ollama backend.
 */
export async function callOllama(params: OllamaCallParams): Promise<OllamaResult> {
  // Chain onto gpuSlot. The previous occupant's resolution gates this one.
  // We swap `gpuSlot` to a new promise that resolves when *this* call ends
  // (success or failure) so the next caller waits on us.
  const prev = gpuSlot;
  let release!: () => void;
  const ours = new Promise<void>((resolve) => {
    release = resolve;
  });
  gpuSlot = ours;
  try {
    await prev.catch(() => undefined);
    return await callOllamaInner(params);
  } finally {
    release();
  }
}

async function callOllamaInner(params: OllamaCallParams): Promise<OllamaResult> {
  const lockHandle = await acquireRedisSlot();
  try {
    return await postWithFallback(params);
  } finally {
    await releaseRedisSlot(lockHandle);
  }
}

async function postWithFallback(params: OllamaCallParams): Promise<OllamaResult> {
  const localUrl = (params.baseUrl ?? config.ollamaUrl).replace(/\/+$/, "");
  const remoteUrl = params.preferRemote ? getRemoteOllamaUrl() : null;
  const remoteTimeoutMs = params.remoteTimeoutMs ?? REMOTE_PROBE_TIMEOUT_MS;
  const tag = params.tag ?? "llm";
  const promptChars = (params.system?.length ?? 0) + (params.user?.length ?? 0);

  // One PULSE_RUN row per Ollama call, child of the currently-active run
  // (e.g. v3:sleep) when present. The runId is woven into log lines via
  // withContext so heartbeat + done lines are co-greppable.
  const parent = currentContext();
  const runId = mintRunId("ollama", tag, 1);
  startRun({
    cluster: "ollama",
    key: tag,
    scope: "instant",
    runId,
    parentRunId: parent?.runId,
    meta: { model: params.model, prompt_chars: promptChars },
  });

  return withContext({ runId }, async () => {
    log.info("llm", `→ ${tag} model=${params.model} prompt_chars=${promptChars}`);
    const tStart = Date.now();

    if (remoteUrl) {
      try {
        const remoteResult = await postOllama({
          url: remoteUrl,
          params,
          timeoutMs: remoteTimeoutMs,
        });
        const reasonTag = remoteResult.doneReason && remoteResult.doneReason !== "stop"
          ? ` done=${remoteResult.doneReason}`
          : "";
        log.info(
          "llm",
          `← ${tag} ok ${remoteResult.totalMs}ms in=${remoteResult.promptTokens} out=${remoteResult.evalTokens}${reasonTag} endpoint=remote`,
        );
        finishRun(runId, {
          status: "ok",
          prompt_chars: remoteResult.promptTokens,
          eval_tokens: remoteResult.evalTokens,
          meta: { endpoint: "remote", done_reason: remoteResult.doneReason },
        });
        return { ...remoteResult, endpoint: "remote", endpointUrl: remoteUrl };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("llm", `remote ${remoteUrl} unavailable (${msg.slice(0, 160)}); fallback local`);
      }
    }

    try {
      const localResult = await postOllama({ url: localUrl, params, timeoutMs: config.llmTimeoutMs });
      const reasonTag = localResult.doneReason && localResult.doneReason !== "stop"
        ? ` done=${localResult.doneReason}`
        : "";
      log.info(
        "llm",
        `← ${tag} ok ${localResult.totalMs}ms in=${localResult.promptTokens} out=${localResult.evalTokens}${reasonTag} endpoint=local`,
      );
      finishRun(runId, {
        status: "ok",
        prompt_chars: localResult.promptTokens,
        eval_tokens: localResult.evalTokens,
        meta: { endpoint: "local", done_reason: localResult.doneReason },
      });
      return { ...localResult, endpoint: "local", endpointUrl: localUrl };
    } catch (err) {
      const dt = Date.now() - tStart;
      const msg = err instanceof Error ? err.message : String(err);
      log.error("llm", `← ${tag} fail ${dt}ms — ${msg.slice(0, 200)}`);
      finishRun(runId, { status: "fail", error: msg.slice(0, 200) });
      throw err;
    }
  }) as Promise<OllamaResult>;
}

interface PostArgs {
  url: string;
  params: OllamaCallParams;
  /** AbortController-driven timeout; null disables. */
  timeoutMs: number | null;
}

/**
 * Heartbeat cadence for in-flight Ollama POSTs. Every `HEARTBEAT_MS` we emit
 * one info-level log line AND tick the active run row (if any). Catches
 * wedged generations within ~30 s instead of `llmTimeoutMs` later.
 */
const HEARTBEAT_MS = 30_000;

async function postOllama(args: PostArgs): Promise<Omit<OllamaResult, "endpoint" | "endpointUrl">> {
  const { url, params, timeoutMs } = args;
  const body = {
    model: params.model,
    stream: false,
    /**
     * Do NOT set `think: false` on qwen3.6 — empirically it silently bypasses
     * the `format` grammar engine, so the model emits free prose despite the
     * schema (verified 2026-05-16: same prompt + schema, `think: false` →
     * markdown prose, `think` unset → schema-valid JSON). Default thinking
     * costs latency but is the price of actual constraint. If the model hits
     * `done_reason: length` with empty content, raise `num_predict` rather
     * than re-disabling thinking.
     */
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    format: params.format,
    options: { ...config.ollamaOptions, ...(params.options ?? {}) },
  };

  const fullUrl = `${url}/api/chat`;
  const tag = params.tag ?? "llm";
  const promptChars = (params.system?.length ?? 0) + (params.user?.length ?? 0);
  const t0 = Date.now();
  const controller = timeoutMs != null ? new AbortController() : null;
  const timer =
    controller && timeoutMs != null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  // Heartbeat: while the POST is in-flight, emit a "still running" line and
  // push a tracker heartbeat every HEARTBEAT_MS. Cleared in `finally`.
  const heartbeatTimer = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    log.info("llm", `heartbeat ${tag} elapsed=${elapsedSec}s`);
    const ctx = currentContext();
    if (ctx?.runId) {
      runHeartbeat(ctx.runId, { prompt_chars: promptChars });
    }
  }, HEARTBEAT_MS);

  try {
    const res = await undiciFetch(fullUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      dispatcher: longRunDispatcher,
      signal: controller?.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      message?: { content?: string; thinking?: string };
      total_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: string;
    };

    return {
      content: json.message?.content ?? "",
      thinking: json.message?.thinking,
      totalMs: Date.now() - t0,
      promptTokens: json.prompt_eval_count ?? 0,
      evalTokens: json.eval_count ?? 0,
      doneReason: json.done_reason,
    };
  } finally {
    clearInterval(heartbeatTimer);
    if (timer) clearTimeout(timer);
  }
}
