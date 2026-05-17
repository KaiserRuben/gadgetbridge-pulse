"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Pill } from "@/components/ui/pill";

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
      const id = crypto.randomUUID();
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
    <div className="flex flex-col gap-2 items-stretch">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
        className={[
          "inline-flex items-center justify-between gap-3 px-5 py-3 rounded-2xl transition-colors",
          "border border-[var(--color-border)]",
          "bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] active:bg-[var(--color-surface-3)]",
          "disabled:opacity-60 disabled:pointer-events-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-sleep)]",
          props.prominent ? "text-[1.0625rem] font-medium" : "text-[0.9375rem]",
        ].join(" ")}
      >
        <span className="truncate">{props.label}</span>
        <Pill tone={props.tone ?? "neutral"} size="sm">
          {busy ? "…" : "Start"}
        </Pill>
      </button>
      {error && (
        <span className="text-caption text-[var(--color-warn,#b76e00)]" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
