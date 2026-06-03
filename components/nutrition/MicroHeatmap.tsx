"use client";

/**
 * Week × nutrient heatmap. Each cell shows % of target as a saturation
 * step on the nutrition accent. Below 0.7 fades toward border tone; at
 * 1.0+ peaks at the accent. Cells with no data show as faint dashes so
 * the gap is legible (different from "0% met").
 *
 * Designed to mirror the existing chart aesthetic — thin grid lines via
 * gap, mono row labels, no axis frame.
 */

import { cn } from "@/lib/cn";

export type HeatmapCell = {
  /** 0..1.2+ (percentage of target). null = no data. */
  ratio: number | null;
};

export type HeatmapRow = {
  key: string;
  label: string;
  cells: HeatmapCell[]; // one per column
};

export function MicroHeatmap({
  columns,
  rows,
  className,
}: {
  /** column labels (e.g. weekday short labels) */
  columns: string[];
  rows: HeatmapRow[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        className="grid gap-1 items-center"
        style={{
          gridTemplateColumns: `minmax(96px, 7rem) repeat(${columns.length}, minmax(0, 1fr))`,
        }}
      >
        <span />
        {columns.map((c, i) => (
          <span
            key={i}
            className="text-[0.625rem] uppercase tracking-[0.16em] text-subtle text-center font-mono"
          >
            {c}
          </span>
        ))}
      </div>

      {rows.map((row) => (
        <div
          key={row.key}
          className="grid gap-1 items-center"
          style={{
            gridTemplateColumns: `minmax(96px, 7rem) repeat(${columns.length}, minmax(0, 1fr))`,
          }}
        >
          <span className="text-[0.75rem] text-muted truncate">{row.label}</span>
          {row.cells.map((cell, i) => (
            <Cell key={i} ratio={cell.ratio} label={`${row.label} · ${columns[i]}`} />
          ))}
        </div>
      ))}

      <div className="mt-2 flex items-center gap-2 text-[0.625rem] num-mono text-subtle">
        <span>0%</span>
        <span className="flex-1 h-1 rounded-full overflow-hidden border border-[var(--color-border)]">
          <span
            className="block h-full"
            style={{
              background:
                "linear-gradient(90deg, color-mix(in srgb, var(--color-nutrition) 22%, var(--color-bg)), color-mix(in srgb, var(--color-nutrition) 55%, var(--color-bg)), color-mix(in srgb, var(--color-nutrition) 80%, var(--color-bg)), var(--color-nutrition))",
            }}
          />
        </span>
        <span>100%+ Ziel</span>
      </div>
    </div>
  );
}

function Cell({ ratio, label }: { ratio: number | null; label: string }) {
  if (ratio == null) {
    return (
      <span
        className="aspect-square w-full rounded-md border border-dashed border-[var(--color-border)] grid place-items-center"
        title={`${label}: keine Daten`}
        aria-label={`${label}: keine Daten`}
      >
        <span className="text-faint text-[0.625rem]">·</span>
      </span>
    );
  }
  const r = Math.max(0, Math.min(1.2, ratio));
  // Map 0..1 → accent-mix 22..100%; >=1 caps at the full nutrition accent.
  const mix = Math.round(22 + Math.min(1, r) * 78);
  const bg =
    r >= 1
      ? "var(--color-nutrition)"
      : `color-mix(in srgb, var(--color-nutrition) ${mix}%, var(--color-bg))`;
  return (
    <span
      className="aspect-square w-full rounded-md border border-[var(--color-border)] grid place-items-center"
      style={{ background: bg }}
      title={`${label}: ${Math.round(r * 100)}%`}
      aria-label={`${label}: ${Math.round(r * 100)} Prozent`}
    >
      {r >= 1 && (
        <span className="text-[0.5rem] num-mono text-[var(--color-text)] mix-blend-screen opacity-80">
          ●
        </span>
      )}
    </span>
  );
}
