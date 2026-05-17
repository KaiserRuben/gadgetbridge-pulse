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
        <span className="text-faint text-[0.6875rem] uppercase tracking-wide">
          Begründung (optional, wird im LLM-Kontext zitiert)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[0.9375rem]"
          placeholder="z.B. „Knie noch nicht stabil genug für Volumen-Sprung — auf Status quo halten.“"
        />
      </label>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => submit("accept")}
          disabled={busy != null}
          className="px-4 h-10 rounded-xl bg-[var(--color-activity)] text-[var(--color-bg)] hover:opacity-90 disabled:opacity-60 text-[0.9375rem]"
        >
          {busy === "accept" ? "…" : "Annehmen"}
        </button>
        <button
          type="button"
          onClick={() => submit("reject")}
          disabled={busy != null}
          className="px-4 h-10 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-[0.9375rem]"
        >
          {busy === "reject" ? "…" : "Ablehnen"}
        </button>
      </div>
      {error && (
        <p className="text-caption text-[var(--color-warn,#b76e00)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
