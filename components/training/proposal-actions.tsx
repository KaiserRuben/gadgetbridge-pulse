"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ProposalActionsProps {
  proposalId: number;
  isPending: boolean;
}

/**
 * Accept / reject controls for a single AdjustmentProposal. Both actions
 * accept an optional `resolution_note`; the runner's LLM context bundles
 * these notes back into every subsequent analysis (Q2 in TRAINING_PLAN_DESIGN.md).
 */
export function ProposalActions(props: ProposalActionsProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(kind: "accept" | "reject") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/training/proposal/${props.proposalId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution_note: note.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push("/training/proposals");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  if (!props.isPending) {
    return <p className="text-caption text-muted">Vorschlag bereits aufgelöst.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="eyebrow">
          Begründung (optional, wird im LLM-Kontext zitiert)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-body"
          placeholder="z.B. „Knie noch nicht stabil genug für Volumen-Sprung — auf Status quo halten.“"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => submit("accept")}
          disabled={busy != null}
          className="h-10 rounded-[var(--radius-card)] bg-[var(--color-activity)] px-4 text-body text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy === "accept" ? "…" : "Annehmen"}
        </button>
        <button
          type="button"
          onClick={() => submit("reject")}
          disabled={busy != null}
          className="h-10 rounded-[var(--radius-card)] border border-[var(--color-border)] px-4 text-body transition-colors hover:bg-[var(--color-surface-2)]"
        >
          {busy === "reject" ? "…" : "Ablehnen"}
        </button>
      </div>
      {error && (
        <p className="text-caption text-[var(--color-band-down)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
