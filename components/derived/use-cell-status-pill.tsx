"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Pill } from "@/components/ui/pill";
import { freshnessPill } from "@/lib/derived/cell-status";
import type { CellState } from "@/lib/derived/state";

/**
 * Hook variant of the freshness pill, exposed so consumer cells can compose
 * the pill into their own custom eyebrow rows when DerivedCell's default
 * top-strip isn't where they want the status to land. Self-ticks every 30s
 * while `ready_fresh` so the "gerade berechnet" tag retires automatically
 * across the 5-minute boundary.
 *
 * Returns a `ReactNode` (or `null`) — drop straight into JSX.
 */
export function useCellStatusPill(
  state: CellState,
  updatedAt: string | null,
): ReactNode {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (state !== "ready_fresh") return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [state]);
  const pill = freshnessPill(state, updatedAt, now);
  if (!pill) return null;
  return (
    <Pill tone={pill.tone} size="sm">
      {pill.label}
    </Pill>
  );
}
