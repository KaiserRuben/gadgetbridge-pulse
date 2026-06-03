"use client";

import { useState } from "react";

import type { SlotId } from "@/runner/v4/types.ts";

/**
 * Standalone slot-retry button for the /coach 14-day list. Each row is for
 * a different `period_key`, so wrapping every row in a ViewStateProvider
 * (and 14 EventSource connections) would be wasteful. This component POSTs
 * to /api/view/<date>/retry/<slot_id> directly and surfaces the error inline.
 */
export function CoachRetryButton({
  period_key,
  slot_id,
  label = "Neu berechnen",
  className,
}: {
  period_key: string;
  slot_id: SlotId;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onClick = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/view/${period_key}/retry/${slot_id}`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `retry failed (${r.status})`);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || done}
        className="inline-flex h-7 items-center rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-3 text-xs font-medium ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
      >
        {busy ? "läuft…" : done ? "geplant" : label}
      </button>
      {error ? (
        <span className="ml-2 text-[0.6875rem] text-[var(--color-band-down)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
