"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Pill } from "@/components/ui/pill";

// crypto.randomUUID() is restricted to secure contexts. Pi is served over
// plain HTTP on the LAN, so fall back to a v4 built from getRandomValues
// (available everywhere) or Math.random as a last resort.
function newSessionId(): string {
  const g = globalThis as { crypto?: Crypto };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

export interface StartSessionButtonProps {
  /** Defaults to today's wake-date local key. */
  periodKey: string;
  sessionTemplateId: string | null;
  /** Non-null when the user picks a non-suggested template. */
  deviationReason: "user_choice" | "recovery" | "schedule" | "other" | null;
  label: string;
  tone?: Parameters<typeof Pill>[0]["tone"];
  prominent?: boolean;
}

/**
 * One-tap session starter. Mints a UUID client-side so retries during a
 * flaky gym connection are idempotent, then POSTs to /api/training/session.
 * Server-side createSession() returns the existing row if the id is already
 * known, so this is safe under double-tap or back-button replay.
 */
export function StartSessionButton(props: StartSessionButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = newSessionId();
      const res = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          period_key: props.periodKey,
          session_template_id: props.sessionTemplateId,
          deviation_reason: props.deviationReason,
          started_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push(`/training/session/${id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
        className={[
          "inline-flex items-center justify-between gap-3 rounded-[var(--radius-card)] px-5 py-3 transition-colors",
          "border border-[var(--color-border)]",
          "bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] active:bg-[var(--color-surface-3)]",
          "disabled:pointer-events-none disabled:opacity-60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-activity)]",
          props.prominent ? "text-[1.0625rem] font-medium" : "text-body",
        ].join(" ")}
      >
        <span className="truncate">{props.label}</span>
        <Pill tone={props.tone ?? "neutral"} size="sm">
          {busy ? "…" : "Start"}
        </Pill>
      </button>
      {error && (
        <span className="text-caption text-[var(--color-band-down)]" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
