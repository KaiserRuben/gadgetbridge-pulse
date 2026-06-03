"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconBadge } from "@/components/ui/icon-badge";

export interface ChatPanelProps {
  initialThreadId?: string | null;
}

interface UiMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string | null;
  status: string;
  created_at: string;
  endpoint?: "remote" | "local" | null;
  error?: string | null;
}

interface SendResponse {
  ok: boolean;
  queued?: boolean;
  thread_id: string;
  user_message_id: number;
  assistant_message_id?: number;
  content?: string | null;
  error?: string;
}

interface ThreadResponse {
  thread: { id: string; title: string | null };
  messages: UiMessage[];
}

const POLL_INTERVAL_MS = 6_000;

export function ChatPanel(props: ChatPanelProps) {
  const [threadId, setThreadId] = useState<string | null>(props.initialThreadId ?? null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/training/chat/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as ThreadResponse;
      setMessages(body.messages);
    } catch {
      /* swallow, next poll retries */
    }
  }, []);

  // Poll while any user message is still queued.
  useEffect(() => {
    if (!threadId) return;
    const hasQueued = messages.some((m) => m.role === "user" && m.status === "queued");
    if (!hasQueued) return;
    pollRef.current = setTimeout(async () => {
      try {
        await fetch("/api/training/chat/drain", { method: "POST" });
      } catch {
        /* ignore */
      }
      await loadThread(threadId);
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [threadId, messages, loadThread]);

  useEffect(() => {
    if (threadId) void loadThread(threadId);
  }, [threadId, loadThread]);

  async function send() {
    if (busy) return;
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/training/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId, content }),
      });
      const body = (await res.json()) as SendResponse;
      if (body.thread_id && body.thread_id !== threadId) setThreadId(body.thread_id);
      setDraft("");
      // Always reload — covers both immediate-reply and queued paths.
      await loadThread(body.thread_id);
      if (!body.ok && !body.queued) {
        setError(body.error ?? "Senden fehlgeschlagen.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <IconBadge icon="Brain" tone="activity" variant="solid" size="sm" />
          <Eyebrow>Frag Pulse</Eyebrow>
          <Pill tone="neutral" size="sm">remote LLM</Pill>
          {messages.some((m) => m.status === "queued") && (
            <Pill tone="down" size="sm">wartet auf Mac-Erreichbarkeit</Pill>
          )}
        </div>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-caption italic text-muted">
              Stelle deine erste Frage. Kontext (aktiver Plan, letzte 7 Tage Sessions, Schmerz-Flags) wird
              automatisch angehängt.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={[
                  "rounded-[var(--radius-card)] border p-3",
                  m.role === "user"
                    ? "max-w-[85%] self-end border-[var(--color-border)] bg-[var(--color-surface-2)]/40"
                    : "max-w-[85%] border-[var(--color-border)] bg-[var(--color-surface)]",
                ].join(" ")}
              >
                <div className="mb-1 flex items-center gap-2">
                  <Pill tone={m.role === "user" ? "neutral" : "activity"} size="sm">
                    {m.role === "user" ? "Du" : "Pulse"}
                  </Pill>
                  {m.status === "queued" && (
                    <Pill tone="down" size="sm">wartet</Pill>
                  )}
                  {m.status === "failed" && (
                    <Pill tone="down" size="sm">Fehler</Pill>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-body">
                  {m.content ?? (m.status === "queued" ? "…" : "(leer)")}
                </p>
                {m.error && (
                  <p className="mt-1 text-caption text-[var(--color-band-down)]">{m.error}</p>
                )}
              </div>
            ))
          )}
        </div>
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="z.B. „Soll ich heute Tag B machen, Rücken fühlt sich angespannt an?“"
            className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-body"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={send}
              disabled={busy || draft.trim().length === 0}
              className="h-10 rounded-[var(--radius-card)] bg-[var(--color-activity)] px-4 text-body text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "…" : "Senden"}
            </button>
            {error && (
              <span className="text-caption text-[var(--color-band-down)]" role="alert">
                {error}
              </span>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
