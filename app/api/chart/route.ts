import "server-only";
import { NextResponse } from "next/server";

import {
  CHART_TYPES,
  METRICS,
  parseChartSpec,
  type DynamicChartSpec,
} from "@/lib/chart-spec";
import { fetchDynamicChartData } from "@/lib/queries/dynamic";

export const dynamic = "force-dynamic";

const OLLAMA_LOCAL_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_REMOTE_URL = process.env.OLLAMA_REMOTE_URL?.trim();
const CHART_MODEL = process.env.PULSE_CHART_MODEL ?? "ministral-3:3b";
const LOCAL_TIMEOUT_MS = 300_000;
/**
 * The remote endpoint is best-effort — when the off-network host is
 * unreachable we want to fall through to the local Ollama within a tight
 * UX budget. 3s matches the constraint in the user's brief.
 */
const REMOTE_PROBE_TIMEOUT_MS = 3_000;

const SYSTEM_PROMPT = `You are a chart-spec extractor for a personal health dashboard.

Given a free-text request, output ONE JSON object matching this schema (no prose, no markdown fences, no fields outside the schema):

{
  "chart_type": ${JSON.stringify(CHART_TYPES)},
  "metrics": <array of one or more from ${JSON.stringify(METRICS)}>,
  "span": { "kind": "last_n_days"|"current_iso_week"|"prior_iso_week"|"current_iso_month"|"prior_iso_month", "n": <int 1-365 if last_n_days> },
  "comparison": { "kind": "none"|"vs_prior_period"|"vs_baseline_14d"|"vs_baseline_30d"|"vs_same_dow" },
  "filter": { "workout_only"?: bool, "weekday_only"?: bool, "band"?: "good"|"mixed"|"bad", "min_sleep_min"?: int },
  "reasoning": "<one sentence German>"
}

RULES
- Closed enums only. Never invent chart_type or metric names.
- DO NOT emit absolute dates. Pick a relative span; the server resolves dates.
- If user says "vs Vorwoche"/"compared to last week" → comparison.kind="vs_prior_period".
- If user says "Wochentage"/"weekdays" → filter.weekday_only=true.
- If user mentions Heatmap/calendar/by weekday → chart_type="calendar".
- If user mentions correlation/scatter/relationship → chart_type="scatter".
- If user mentions distribution/histogram → chart_type="distribution".
- If user mentions stacked or two metrics on same axis → chart_type="stacked".
- If user mentions comparison/vs/compared → chart_type="comparison".
- Default chart_type="trend" otherwise.
- Default span={"kind":"last_n_days","n":30} when unclear.
- "rhr"="resting heart rate", "hrv"="heart rate variability", "tst"="total sleep time", "rem"="REM sleep", "deep"="deep sleep", "spo2"="blood oxygen", "acwr"="acute:chronic workload ratio", "training_load"="acute training load (7d EWMA)".
- "Schlafqualität"→"sleep_score". "Schritte"→"steps". "Ruhepuls"→"rhr". "Stress"→"stress". "Gewicht"→"weight". "Schlaf"→"sleep_score" or "tst" depending on context.
- reasoning: 1 short German sentence describing what the chart shows.`;

interface OllamaCallResult {
  spec: unknown;
  endpoint: "remote" | "local";
  endpointUrl: string;
  durationMs: number;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  // Two entry modes: either an LLM prompt, or a pre-baked spec (chip).
  let spec: DynamicChartSpec | null = null;
  let llmDebug: {
    endpoint: "remote" | "local";
    endpoint_url: string;
    duration_ms: number;
  } | null = null;

  if (b.spec) {
    spec = parseChartSpec(b.spec);
    if (!spec) {
      return NextResponse.json({ error: "spec validation failed" }, { status: 400 });
    }
  } else {
    const prompt = b.prompt;
    if (typeof prompt !== "string" || prompt.length < 2 || prompt.length > 800) {
      return NextResponse.json({ error: "prompt must be 2-800 chars" }, { status: 400 });
    }
    let llmError: string | null = null;
    try {
      const res = await callOllama(prompt);
      const parsed = parseChartSpec(res.spec);
      if (!parsed) {
        llmError = "spec failed validation";
      } else {
        spec = parsed;
        llmDebug = {
          endpoint: res.endpoint,
          endpoint_url: res.endpointUrl,
          duration_ms: res.durationMs,
        };
      }
    } catch (e) {
      llmError = e instanceof Error ? e.message : String(e);
    }
    if (!spec) {
      return NextResponse.json(
        { error: llmError ?? "spec generation failed" },
        { status: 502 },
      );
    }
  }

  const data = await fetchDynamicChartData(spec);
  return NextResponse.json({ spec, data, debug: llmDebug });
}

/**
 * Race-and-fallback. If `OLLAMA_REMOTE_URL` is set, probe it first with a
 * 3s budget; on timeout/5xx/ECONNREFUSED, fall through to the local
 * Ollama with the standard 25s budget. The endpoint is surfaced in the
 * returned object so the API caller can show which instance served them.
 */
async function callOllama(userPrompt: string): Promise<OllamaCallResult> {
  if (OLLAMA_REMOTE_URL) {
    const remoteUrl = OLLAMA_REMOTE_URL.replace(/\/+$/, "");
    const t0 = Date.now();
    try {
      const spec = await postOllama(remoteUrl, userPrompt, REMOTE_PROBE_TIMEOUT_MS);
      return {
        spec,
        endpoint: "remote",
        endpointUrl: remoteUrl,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[chart] remote ${remoteUrl} unavailable (${msg.slice(0, 200)}); falling back to local`,
      );
    }
  }

  const localUrl = OLLAMA_LOCAL_URL.replace(/\/+$/, "");
  const t0 = Date.now();
  const spec = await postOllama(localUrl, userPrompt, LOCAL_TIMEOUT_MS);
  return {
    spec,
    endpoint: "local",
    endpointUrl: localUrl,
    durationMs: Date.now() - t0,
  };
}

async function postOllama(
  baseUrl: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: CHART_MODEL,
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: 512 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const payload = (await res.json()) as { message?: { content?: string } };
    const content = payload.message?.content ?? "";
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}
