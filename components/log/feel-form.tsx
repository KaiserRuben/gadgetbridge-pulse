"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { INITIAL_LOG_STATE, type LogActionState } from "./action-state";
import { FormFeedback } from "./form-feedback";
import { cn } from "@/lib/cn";

const SCALE = [
  { v: 1, label: "schlecht", color: "var(--color-tier-s1)" },
  { v: 2, label: "mau",      color: "var(--color-tier-s2)" },
  { v: 3, label: "okay",     color: "var(--color-band-steady)" },
  { v: 4, label: "gut",      color: "var(--color-band-up)" },
  { v: 5, label: "stark",    color: "var(--color-activity)" },
] as const;

export function FeelForm({
  action,
}: {
  action: (prev: LogActionState, fd: FormData) => Promise<LogActionState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL_LOG_STATE);
  const [feel, setFeel] = useState<number | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (feel != null) noteRef.current?.focus();
  }, [feel]);

  return (
    <form action={submit} className="flex flex-col gap-5">
      <input type="hidden" name="feel" value={feel ?? ""} />
      <fieldset className="flex flex-col gap-3">
        <span className="eyebrow">Wie fühlst du dich?</span>
        <div className="grid grid-cols-5 gap-1.5">
          {SCALE.map((s) => {
            const active = feel === s.v;
            return (
              <button
                key={s.v}
                type="button"
                onClick={() => setFeel(s.v)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-[var(--radius-card)] border bg-[var(--color-surface-2)]/40 px-2 py-3 transition-all",
                  active ? "border-[var(--color-border-strong)] bg-[var(--color-surface-2)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/70",
                )}
              >
                <motion.span
                  initial={{ scale: 0.9 }}
                  animate={{ scale: active ? 1.08 : 1 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="num text-[1.5rem] font-semibold"
                  style={{ color: active ? s.color : "var(--color-text)" }}
                >
                  {s.v}
                </motion.span>
                <span className="text-caption">{s.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Notiz</span>
        <input
          ref={noteRef}
          name="note"
          type="text"
          placeholder="kurzer Kontext (optional)"
          disabled={pending}
          className="rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-2 outline-none focus:border-[var(--color-border-strong)]"
        />
      </label>

      <button
        type="submit"
        disabled={pending || feel == null}
        className="h-11 rounded-[var(--radius-chip)] bg-gradient-to-br from-[var(--color-sleep)] to-[var(--color-sleep-2)] font-medium text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
      >
        {pending ? "Speichere…" : "Speichern"}
      </button>

      <FormFeedback state={state} icon="HeartPulse" />
    </form>
  );
}
