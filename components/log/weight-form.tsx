"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { INITIAL_LOG_STATE, type LogActionState } from "./action-state";
import { FormFeedback } from "./form-feedback";
import { Sparkline } from "@/components/charts/sparkline";

export function WeightForm({
  defaultValue,
  recent,
  action,
}: {
  defaultValue?: number;
  recent: number[];
  action: (prev: LogActionState, fd: FormData) => Promise<LogActionState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL_LOG_STATE);
  const [value, setValue] = useState(defaultValue?.toString() ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (state.status === "ok") {
      // Keep current value visible briefly, then clear for next entry
      const id = setTimeout(() => setValue(""), 1600);
      return () => clearTimeout(id);
    }
  }, [state.ok_seq, state.status]);

  const numericPreview = parsedValue(value);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="eyebrow">Gewicht</span>
        <div className="relative flex items-baseline gap-2">
          <input
            ref={inputRef}
            name="weight_kg"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            autoComplete="off"
            placeholder={defaultValue?.toFixed(1) ?? "0.0"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            className="num text-display bg-transparent outline-none flex-1 min-w-0 placeholder:text-[var(--color-text-faint)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            style={{ caretColor: "var(--color-sleep)" }}
          />
          <span className="text-subtle num-mono text-[1.25rem]">kg</span>
        </div>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Körperfett (optional)</span>
        <div className="relative flex items-baseline gap-2 rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-2">
          <input
            name="body_fat_pct"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            autoComplete="off"
            placeholder="—"
            disabled={pending}
            className="num min-w-0 flex-1 bg-transparent text-[1.5rem] font-semibold outline-none placeholder:text-[var(--color-text-faint)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-subtle num-mono">%</span>
        </div>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Notiz</span>
        <input
          name="note"
          type="text"
          autoComplete="off"
          placeholder="z.B. nüchtern, Sonntag morgen"
          disabled={pending}
          className="text-body rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-2 outline-none focus:border-[var(--color-border-strong)]"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !numericPreview}
          className="h-11 flex-1 rounded-[var(--radius-chip)] bg-gradient-to-br from-[var(--color-sleep)] to-[var(--color-sleep-2)] font-medium tracking-tight text-white transition-[filter] hover:brightness-110 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-sleep)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
        >
          {pending ? "Speichere…" : "Speichern"}
        </button>
        <DeltaHint candidate={numericPreview} previous={recent[0]} />
      </div>

      <FormFeedback state={state} icon="Sparkles">
        <Sparkline values={[...recent.slice(0, 8).reverse(), numericPreview ?? recent[0]]} tone="sleep" width={88} height={26} />
      </FormFeedback>
    </form>
  );
}

function DeltaHint({ candidate, previous }: { candidate: number | null; previous?: number }) {
  if (candidate == null || previous == null) return <span className="text-caption" />;
  const delta = +(candidate - previous).toFixed(1);
  if (delta === 0) return <span className="num-mono text-caption">±0.0 kg</span>;
  const tone = delta > 0 ? "text-[var(--color-band-up)]" : "text-[var(--color-band-down)]";
  return (
    <span className={`num-mono text-caption ${tone}`}>
      {delta > 0 ? "+" : "−"}{Math.abs(delta).toFixed(1)} kg
    </span>
  );
}

function parsedValue(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
