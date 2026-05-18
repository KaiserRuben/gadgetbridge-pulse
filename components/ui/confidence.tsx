import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { confidenceTier } from "@/lib/confidence";

import { Pill } from "./pill";

/**
 * Unified confidence primitive. Replaces three rendering modes that grew up
 * piecemeal across the dashboard:
 *
 *   mode="bar"  — the original 16×4px bar + percentage label (legacy
 *                 `<ConfidenceBar>` visual; that component stays for back-
 *                 compat but is deprecated).
 *   mode="pill" — `<Pill tone={tier}>Konfidenz NN%</Pill>` — the inline form
 *                 used near eyebrows + headlines.
 *   mode="dot"  — 8×8px tier-coloured dot with an `aria-label` for screen
 *                 readers. Compact form for tight rows (lists, footers).
 *
 * Tier mapping is exported from `lib/confidence.ts` so anyone consuming the
 * threshold ladder outside this component stays in sync.
 */

type ConfidenceMode = "bar" | "pill" | "dot";

interface ConfidenceProps {
  /** 0..1 — clamped before rendering. */
  value: number;
  mode?: ConfidenceMode;
  className?: string;
}

const TIER_VAR: Record<ReturnType<typeof confidenceTier>, string> = {
  up: "var(--color-band-up)",
  steady: "var(--color-band-steady)",
  down: "var(--color-band-down)",
};

export function Confidence({ value, mode = "bar", className }: ConfidenceProps): ReactNode {
  const clamped = Math.max(0, Math.min(1, value));
  const pct = clamped * 100;
  const tier = confidenceTier(clamped);
  const tone = TIER_VAR[tier];
  const rounded = Math.round(pct);

  if (mode === "pill") {
    return (
      <Pill tone={tier} size="sm" className={className}>
        Konfidenz {rounded}%
      </Pill>
    );
  }

  if (mode === "dot") {
    return (
      <span
        role="img"
        aria-label={`Konfidenz ${rounded}%`}
        className={cn("inline-block size-2 rounded-full align-middle", className)}
        style={{ background: tone }}
      />
    );
  }

  // Default: bar
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-1 w-16 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: tone }}
        />
      </div>
      <span className="text-caption">{rounded}%</span>
    </div>
  );
}
