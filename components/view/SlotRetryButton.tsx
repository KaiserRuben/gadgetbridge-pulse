"use client";

import { useState } from "react";

import { useViewState } from "@/lib/view-state/context";
import type { SlotId } from "@/runner/v4/types.ts";

export function SlotRetryButton({
  slot_id,
  event_id,
  observation_id,
  label = "Neu berechnen",
  className,
}: {
  slot_id: SlotId;
  /** Set for event slots — routes to /api/view/<date>/event/<slot_id>. */
  event_id?: string;
  /** Optional observation context for anomaly_explain retries. */
  observation_id?: string;
  label?: string;
  className?: string;
}) {
  const { period_key, retrySlot } = useViewState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (event_id) {
        const body: Record<string, string> = { event_id };
        if (observation_id) body.observation_id = observation_id;
        const r = await fetch(
          `/api/view/${period_key}/event/${slot_id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!r.ok) {
          const b = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? `retry failed (${r.status})`);
        }
      } else {
        await retrySlot(slot_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex h-7 items-center rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-3 text-xs font-medium ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
      >
        {busy ? "läuft…" : label}
      </button>
      {error ? (
        <span className="ml-2 text-[0.6875rem] text-[var(--color-band-down)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
