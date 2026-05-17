"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type Item = {
  date: string;
  band?: "above_usual" | "below_usual" | "steady" | null;
  score?: number | null;
};

const bandFill: Record<"above_usual" | "below_usual" | "steady" | "none", string> = {
  above_usual: "var(--color-band-up)",
  below_usual: "var(--color-band-down)",
  steady:      "var(--color-band-steady)",
  none:        "var(--color-band-low)",
};

export function BandStrip({
  items,
  hrefBase = "/?d=",
  size = 36,
  active,
}: {
  items: Item[];
  hrefBase?: string;
  size?: number;
  active?: string;
}) {
  return (
    <ol className="flex items-end gap-1.5">
      {items.map((it, i) => {
        const c = bandFill[it.band ?? "none"];
        const score = it.score ?? null;
        const heightPct = score == null ? 0.45 : Math.max(0.25, Math.min(1, score / 100));
        const isActive = active === it.date;
        const day = it.date.slice(8, 10);
        return (
          <li key={it.date}>
            <Link
              href={`${hrefBase}${it.date}`}
              className={cn(
                "group grid place-items-center gap-1.5 px-1 py-1 rounded-md hover:bg-[var(--color-surface)]/50",
                isActive && "bg-[var(--color-surface-2)]/70",
              )}
            >
              <motion.span
                className="block rounded-sm"
                style={{ background: c, width: size, height: size * heightPct }}
                initial={{ scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: it.band ? 0.85 : 0.4 }}
                transition={{ duration: 0.3, delay: i * 0.015, ease: [0.16, 1, 0.3, 1] }}
              />
              <span className={cn("text-caption", isActive && "text-[var(--color-text)]")}>{day}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
