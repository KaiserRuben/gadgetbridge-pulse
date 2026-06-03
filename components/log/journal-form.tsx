"use client";

import { useActionState, useEffect, useRef } from "react";
import { INITIAL_LOG_STATE, type LogActionState } from "./action-state";
import { FormFeedback } from "./form-feedback";

export function JournalForm({
  action,
}: {
  action: (prev: LogActionState, fd: FormData) => Promise<LogActionState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL_LOG_STATE);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Eintrag</span>
        <textarea
          ref={ref}
          name="text"
          placeholder="Was war heute…"
          rows={6}
          disabled={pending}
          className="text-body resize-none rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-3 leading-snug outline-none focus:border-[var(--color-border-strong)]"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Stimmung 1–5 (optional)</span>
        <input
          name="mood"
          type="number"
          inputMode="numeric"
          min={1}
          max={5}
          placeholder="3"
          disabled={pending}
          className="num-mono rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-2 outline-none focus:border-[var(--color-border-strong)]"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Tags (komma-getrennt)</span>
        <input
          name="tags"
          type="text"
          placeholder="laufen, kaffee, kopfschmerzen"
          disabled={pending}
          className="rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-2 outline-none focus:border-[var(--color-border-strong)]"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-[var(--radius-chip)] bg-gradient-to-br from-[var(--color-sleep)] to-[var(--color-sleep-2)] font-medium text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
      >
        {pending ? "Speichere…" : "Speichern"}
      </button>

      <FormFeedback state={state} icon="PenLine" />
    </form>
  );
}
