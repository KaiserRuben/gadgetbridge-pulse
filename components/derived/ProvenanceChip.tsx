"use client";

import { useState } from "react";

import { Glyph } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import type { ProvenanceTag } from "@/runner/jobs/types";

import { ProvenanceRow } from "./ProvenanceRow";

/**
 * Collapsed-chip variant of `<ProvenanceRow>`. Per OQ-1 this is the default
 * provenance display everywhere except synthesis cells + meal-detail (those
 * keep the always-visible row).
 *
 * Visual: small button `[⌄ N Quellen]` where N is the distinct source count.
 * Tap toggles the full ProvenanceRow inline below. Hover (desktop) shows
 * a title tooltip preview listing source names.
 *
 * If any tag has `source: "user_edited"`, an adjacent `<Pill tone="up">
 * Bearbeitet</Pill>` is rendered — high-trust prominence so user-edited
 * payloads stay visually distinct from pure machine output.
 */

interface ProvenanceChipProps {
  tags: ProvenanceTag[];
  className?: string;
}

const SOURCE_LABEL_DE: Record<string, string> = {
  wearable_sensor: "Wearable",
  user_input: "Eigeneingabe",
  vlm_inferred: "Kamera-KI",
  llm_derived: "KI-Berechnung",
  rule_computed: "Regelbasiert",
  user_edited: "Bearbeitet",
  seed_data: "Referenzwert",
  manual_log: "Manuell",
  external_db: "Datenbank",
};

export function ProvenanceChip({ tags, className }: ProvenanceChipProps) {
  const [open, setOpen] = useState(false);
  if (!tags || tags.length === 0) return null;

  const distinctSources = Array.from(new Set(tags.map((t) => t.source)));
  const hasUserEdited = distinctSources.includes("user_edited");
  const count = distinctSources.length;
  const tooltip = distinctSources
    .map((s) => SOURCE_LABEL_DE[s] ?? s)
    .join(" · ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={tooltip}
          className={cn(
            "inline-flex items-center gap-1 px-2 h-6 rounded-[var(--radius-pill)] ring-1 ring-inset",
            "bg-[hsl(240_4%_15%)] text-[var(--color-text-muted)] ring-[var(--color-border)]",
            "text-[0.6875rem] font-medium tracking-[0.02em]",
            "transition-colors hover:text-[var(--color-text)] hover:bg-[hsl(240_4%_18%)]",
            "focus:outline-none focus-visible:ring-[var(--color-border-strong)]",
          )}
        >
          <Glyph
            name="ChevronRight"
            size={12}
            className={cn(
              "transition-transform",
              open ? "rotate-90" : "",
            )}
          />
          <span className="num-mono">{count}</span>
          <span>{count === 1 ? "Quelle" : "Quellen"}</span>
        </button>
        {hasUserEdited && (
          <Pill tone="up" size="sm">
            Bearbeitet
          </Pill>
        )}
      </div>
      {open && <ProvenanceRow tags={tags} />}
    </div>
  );
}
