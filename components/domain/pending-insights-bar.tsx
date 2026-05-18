"use client";

import Link from "next/link";
import { useState } from "react";

import { Glyph } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";

/**
 * Compact one-row "X Analysen ausstehend" strip for the home page.
 *
 * When the runner hasn't produced an insight yet, we used to render full
 * empty-state cards for every cluster (Tages-Analyse, Morgen-Briefing,
 * Wochen-Recap …) which dominated the viewport on a cold-start day.
 * This bar surfaces the same affordances on a single line — the user
 * still gets the "anfordern" CTA, but the page rhythm stays compact and
 * the actual KPIs land above the fold.
 *
 * Each entry has its own per-cluster enqueue route (POST /api/jobs/...).
 * The bar wires the click handler; the parent page decides which entries
 * to pass in (e.g. only show "Morgen-Briefing" within the wake window).
 */

export interface PendingInsight {
  cluster: string;
  key: string;
  scope?: "daily" | "weekly";
  label: string;
  href?: string;
}

export function PendingInsightsBar({
  items,
  className,
}: {
  items: PendingInsight[];
  className?: string;
}) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  if (items.length === 0) return null;

  async function trigger(item: PendingInsight): Promise<void> {
    const id = `${item.cluster}:${item.key}`;
    if (pending.has(id)) return;
    setPending((s) => new Set(s).add(id));
    try {
      const scope = item.scope ?? "daily";
      await fetch(`/api/jobs/${item.cluster}/${item.key}/enqueue?scope=${scope}`, {
        method: "POST",
      });
    } catch {
      // Surface nothing — the DerivedCell sibling will eventually poll the
      // updated state. The bar's own retry-affordance is a click again.
    } finally {
      // Keep the spinner for a short beat so the user sees feedback.
      setTimeout(() => {
        setPending((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }, 1500);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap rounded-[var(--radius-card)] bg-[var(--color-surface)]/40 border border-[var(--color-border)]/60 px-3 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 shrink-0">
        <Glyph name="Sparkles" size={12} className="text-faint" />
        <span className="eyebrow">Analysen ausstehend</span>
        <Pill tone="low" size="sm">{items.length}</Pill>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {items.map((item) => {
          const id = `${item.cluster}:${item.key}`;
          const isPending = pending.has(id);
          const content = (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-chip)] text-[0.75rem] transition-colors",
                "border border-[var(--color-border-strong)] hover:border-[var(--color-text-muted)]",
                isPending && "opacity-60",
              )}
            >
              <Glyph
                name={isPending ? "RotateCcw" : "Sparkles"}
                size={11}
                className={cn(isPending && "animate-spin")}
              />
              {item.label}
            </span>
          );
          if (item.href) {
            return (
              <Link key={id} href={item.href} className="inline-block">
                {content}
              </Link>
            );
          }
          return (
            <button
              key={id}
              type="button"
              onClick={() => trigger(item)}
              disabled={isPending}
              className="inline-block"
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
