import "server-only";

import type { ChatContextBundle } from "./chat-context";
import type { MessageRow } from "./chat";

/**
 * Remote-only Ollama call for the chat surface.
 *
 * Pipeline = local Ollama. Chat = REMOTE_ONLY (no local fallback). When the
 * remote endpoint is unreachable the caller queues; no degradation, per Q4.
 *
 * Endpoint = `OLLAMA_REMOTE_URL`. Default model = `OLLAMA_REMOTE_MODEL` or
 * `qwen3.6:latest`. Times out after `OLLAMA_REMOTE_TIMEOUT_MS` (default 300s).
 */

const DEFAULT_TIMEOUT_MS = 300_000;

export interface RemoteResult {
  ok: boolean;
  content: string | null;
  endpoint: string | null;
  model: string | null;
  error: string | null;
}

export interface RemoteCallInput {
  messages: MessageRow[];
  newUserContent: string;
  context: ChatContextBundle;
}

const SYSTEM_PROMPT = `Du bist ein Trainings-Coach im Pulse-Dashboard. Du antwortest auf User-Fragen über ihren aktiven Plan, ihre letzten Sessions und ihre Erholungslage.

REGELN
- Antworte ausschließlich auf Deutsch, kurz und sachlich. Du-Form.
- Verwende NUR Daten aus dem CONTEXT-Block. Erfinde keine Zahlen, keine Sessions, keine Übungen.
- Wenn der User nach einer Plan-Änderung fragt: schlage sie als Text vor. NIEMALS direkt umsetzen. Eine Plan-Änderung passiert nur über den Vorschlags-Workflow im Dashboard.
- Wenn du Schmerz-Notizen zitierst (free_text aus pain_flags): wort-für-wort in »…«, niemals paraphrasieren.
- Keine medizinischen Aussagen, keine Diagnosen.`;

function getEndpoint(): string | null {
  // Pi already runs against the Mac's Ollama via `OLLAMA_URL` over Tailscale.
  // Honour `OLLAMA_REMOTE_URL` first for setups that want to split chat
  // from pipeline (e.g. point chat at a different model host), fall back
  // to the regular `OLLAMA_URL` so the simple-config case "just works".
  const raw = (process.env.OLLAMA_REMOTE_URL ?? process.env.OLLAMA_URL)?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getModel(): string {
  return process.env.OLLAMA_REMOTE_MODEL?.trim() || "qwen3.6:latest";
}

function getTimeoutMs(): number {
  const raw = process.env.OLLAMA_REMOTE_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function buildMessages(input: RemoteCallInput): OllamaChatMessage[] {
  const out: OllamaChatMessage[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\nCONTEXT (state at thread time):\n${JSON.stringify(input.context)}`,
    },
  ];
  for (const m of input.messages) {
    if (m.role === "system") continue;
    if (!m.content) continue;
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
  }
  out.push({ role: "user", content: input.newUserContent });
  return out;
}

export async function callRemoteChat(input: RemoteCallInput): Promise<RemoteResult> {
  const endpoint = getEndpoint();
  if (!endpoint) {
    return {
      ok: false,
      content: null,
      endpoint: null,
      model: null,
      error: "OLLAMA_REMOTE_URL not configured",
    };
  }
  const model = getModel();
  const messages = buildMessages(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages,
        // `think: false` skips the chain-of-thought block. Safe here because
        // chat is conversational, not schema-constrained (the pipeline keeps
        // thinking ON because the format-grammar engine requires it — see
        // runner/src/ollama.ts). Setting num_predict=1024 caps a runaway
        // reply at ~2-4kB so a 90s timeout reliably covers the response.
        think: false,
        options: { temperature: 0.3, num_predict: 1024 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        content: null,
        endpoint,
        model,
        error: `HTTP ${res.status}: ${txt.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as { message?: { content?: string } };
    const content = json.message?.content?.trim() ?? "";
    if (!content) {
      return { ok: false, content: null, endpoint, model, error: "empty content" };
    }
    return { ok: true, content, endpoint, model, error: null };
  } catch (err) {
    return {
      ok: false,
      content: null,
      endpoint,
      model,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
