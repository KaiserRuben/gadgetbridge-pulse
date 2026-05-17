import { Agent, fetch as undiciFetch } from "undici";
import { config } from "./config.ts";
import { log } from "./logger.ts";

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
 */
export async function callOllama(params: OllamaCallParams): Promise<OllamaResult> {
  const localUrl = (params.baseUrl ?? config.ollamaUrl).replace(/\/+$/, "");
  const remoteUrl = params.preferRemote ? getRemoteOllamaUrl() : null;
  const remoteTimeoutMs = params.remoteTimeoutMs ?? REMOTE_PROBE_TIMEOUT_MS;
  const tag = params.tag ?? "llm";
  const promptChars = (params.system?.length ?? 0) + (params.user?.length ?? 0);
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
      return { ...remoteResult, endpoint: "remote", endpointUrl: remoteUrl };
    } catch (err) {
      // Surface the failure reason once for diagnostics, then fall through.
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("llm", `remote ${remoteUrl} unavailable (${msg.slice(0, 160)}); fallback local`);
    }
  }

  try {
    const localResult = await postOllama({ url: localUrl, params, timeoutMs: null });
    const reasonTag = localResult.doneReason && localResult.doneReason !== "stop"
      ? ` done=${localResult.doneReason}`
      : "";
    log.info(
      "llm",
      `← ${tag} ok ${localResult.totalMs}ms in=${localResult.promptTokens} out=${localResult.evalTokens}${reasonTag} endpoint=local`,
    );
    return { ...localResult, endpoint: "local", endpointUrl: localUrl };
  } catch (err) {
    const dt = Date.now() - tStart;
    const msg = err instanceof Error ? err.message : String(err);
    log.error("llm", `← ${tag} fail ${dt}ms — ${msg.slice(0, 200)}`);
    throw err;
  }
}

interface PostArgs {
  url: string;
  params: OllamaCallParams;
  /** AbortController-driven timeout; null disables. */
  timeoutMs: number | null;
}

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
  const t0 = Date.now();
  const controller = timeoutMs != null ? new AbortController() : null;
  const timer =
    controller && timeoutMs != null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
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
    if (timer) clearTimeout(timer);
  }
}
