"use client";

/**
 * Horizontal stacked bar for protein/carbs/fat split, with kcal total and
 * optional delta-vs-target chip on the trailing edge. Used:
 *   - day view header
 *   - trends page (one bar per day)
 *
 * Keeps colors aligned with IntakeRing: nutrition (protein), nutrition-2
 * (carbs), temp (fat). Fat reuses temp because fat-share = energy density,
 * which conceptually rhymes with body composition.
 */

import { motion } from "motion/react";
import { cn } from "@/lib/cn";

export function MacroStack({
  protein_g,
  carbs_g,
  fat_g,
  kcal,
  kcalTarget,
  size = "md",
  showLegend = true,
  className,
}: {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  kcal: number;
  kcalTarget?: number | null;
  size?: "sm" | "md";
  showLegend?: boolean;
  className?: string;
}) {
  const p = Math.max(0, protein_g) * 4;
  const c = Math.max(0, carbs_g) * 4;
  const f = Math.max(0, fat_g) * 9;
  const total = p + c + f || 1;
  const pPct = (p / total) * 100;
  const cPct = (c / total) * 100;
  const fPct = (f / total) * 100;

  const delta = kcalTarget != null ? Math.round(kcal - kcalTarget) : null;

  const h = size === "sm" ? "h-2" : "h-2.5";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {showLegend && (
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="num text-[1.125rem] font-semibold">{Math.round(kcal)}</span>
            <span className="text-caption text-subtle num-mono">
              {kcalTarget != null ? `/ ${Math.round(kcalTarget)} kcal` : "kcal"}
            </span>
          </div>
          {delta != null && (
            <span
              className={cn(
                "num-mono text-caption",
                delta > 0
                  ? "text-[var(--color-band-up)]"
                  : delta < 0
                  ? "text-[var(--color-band-down)]"
                  : "text-subtle",
              )}
            >
              {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
              {Math.abs(delta)} kcal
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          "relative w-full rounded-[var(--radius-pill)] overflow-hidden bg-[var(--color-bg-elevated)] border border-[var(--color-border)]",
          h,
        )}
      >
        <motion.div
          className="absolute inset-y-0 left-0"
          style={{ background: "var(--color-nutrition)" }}
          initial={{ width: 0 }}
          animate={{ width: `${pPct}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.div
          className="absolute inset-y-0"
          style={{ left: `${pPct}%`, background: "var(--color-nutrition-2)" }}
          initial={{ width: 0 }}
          animate={{ width: `${cPct}%` }}
          transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.div
          className="absolute inset-y-0"
          style={{ left: `${pPct + cPct}%`, background: "var(--color-temp)" }}
          initial={{ width: 0 }}
          animate={{ width: `${fPct}%` }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {showLegend && (
        <div className="flex items-center justify-between gap-3 text-caption text-subtle">
          <LegendDot color="var(--color-nutrition)" label="Eiweiß" value={`${Math.round(protein_g)} g`} />
          <LegendDot color="var(--color-nutrition-2)" label="KH" value={`${Math.round(carbs_g)} g`} />
          <LegendDot color="var(--color-temp)" label="Fett" value={`${Math.round(fat_g)} g`} />
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span>{label}</span>
      <span className="num-mono text-[var(--color-text-muted)]">{value}</span>
    </span>
  );
}
