"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Glyph } from "@/components/ui/glyph";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; rationale_strength: string; explanation: string; alternatives: string[]; cache: "hit" | "miss" }
  | { kind: "err"; message: string };

export function ExplainSpikeButton({
  ts,
  metric,
  date,
}: {
  ts: number;
  metric: "hr" | "rhr" | "spo2" | "stress" | "hrv";
  date: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [, startTransition] = useTransition();

  function onClick() {
    if (state.kind === "loading") return;
    setState({ kind: "loading" });
    startTransition(async () => {
      try {
        const res = await fetch("/api/explain-anomaly", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ts, metric, date }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setState({
          kind: "ok",
          rationale_strength: json.explanation?.rationale_strength ?? "weak",
          explanation: json.explanation?.explanation_text ?? "",
          alternatives: json.explanation?.alternative_hypotheses ?? [],
          cache: (res.headers.get("X-Cache") as "hit" | "miss") ?? "miss",
        });
      } catch (e) {
        setState({ kind: "err", message: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={state.kind === "loading"}
        className="self-start inline-flex items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[0.875rem] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-60"
      >
        <Glyph name={state.kind === "loading" ? "Sparkles" : "Brain"} size={14} className={state.kind === "loading" ? "animate-pulse" : ""} />
        {state.kind === "loading" ? "Erkläre…" : state.kind === "ok" ? "Erneut erklären" : "Warum?"}
      </button>

      <AnimatePresence mode="popLayout">
        {state.kind === "ok" && (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-3 px-4 py-4 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]"
          >
            <div className="flex items-center gap-2">
              <span className="eyebrow">LLM-Hypothese</span>
              <span className="text-caption num-mono text-subtle">{state.rationale_strength}</span>
              {state.cache === "hit" && <span className="text-caption num-mono text-subtle">cache</span>}
            </div>
            <p className="text-[0.9375rem] leading-snug">{state.explanation}</p>
            {state.alternatives.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {state.alternatives.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-caption">
                    <Glyph name="ArrowRight" size={12} className="mt-0.5 text-subtle" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
        {state.kind === "err" && (
          <motion.div
            key="err"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-caption text-[var(--color-band-down)]"
          >
            {state.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
