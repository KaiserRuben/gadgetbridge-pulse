"use client";

import { motion, AnimatePresence } from "motion/react";
import type { ReactNode } from "react";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import type { LogActionState } from "./action-state";

export function FormFeedback({
  state,
  icon = "Sparkles",
  children,
}: {
  state: LogActionState;
  icon?: GlyphName;
  children?: ReactNode;
}) {
  return (
    <AnimatePresence mode="popLayout">
      {state.status === "ok" && (
        <motion.div
          key={state.ok_seq}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-3 px-3 py-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]"
        >
          <span className="grid place-items-center size-7 rounded-full bg-[var(--color-band-up)]/15 text-[var(--color-band-up)]">
            <Glyph name={icon} size={14} />
          </span>
          <span className="text-[0.875rem] flex-1">{state.message}</span>
          {children}
        </motion.div>
      )}
      {state.status === "error" && (
        <motion.div
          key="err"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--color-band-down)]/10 border border-[var(--color-band-down)]/30"
        >
          <Glyph name="AlarmClock" size={14} className="text-[var(--color-band-down)]" />
          <span className="text-[0.8125rem] text-[var(--color-band-down)]">{state.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
