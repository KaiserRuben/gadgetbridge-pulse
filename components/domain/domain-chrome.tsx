import Link from "next/link";
import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { DateSwipe } from "@/components/nav/date-swipe";
import { addDays } from "@/lib/time";

export function DomainChrome({
  domainLabel,
  date,
  hrefBase,
  icon,
  statusSlot,
}: {
  domainLabel: string;
  date: string;
  hrefBase: string;
  icon: GlyphName;
  /** Optional pill / chip rendered next to the title (e.g. live status). */
  statusSlot?: ReactNode;
}) {
  const [y, m, d] = date.split("-").map(Number);
  const fmt = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin",
  });
  const prev = addDays(date, -1);
  const next = addDays(date, 1);

  return (
    <div className="flex items-end justify-between gap-3">
      {/* Mounts a global swipe listener; no DOM output. Mobile-only effect
         (no harm on desktop — touch events don't fire). */}
      <DateSwipe
        prevHref={`${hrefBase}/${prev}`}
        nextHref={`${hrefBase}/${next}`}
      />
      <div className="flex items-center gap-3">
        <span className="grid place-items-center size-10 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
          <Glyph name={icon} size={18} />
        </span>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Eyebrow>{domainLabel}</Eyebrow>
            {statusSlot}
          </div>
          <h1 className="text-[1.625rem] font-semibold tracking-[-0.02em] leading-tight">{fmt}</h1>
        </div>
      </div>
      <nav className="flex items-center gap-1">
        <Link
          href={`${hrefBase}/${prev}`}
          className="grid place-items-center size-9 rounded-[var(--radius-chip)] text-muted hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/70"
          aria-label="Vorheriger Tag"
        >
          <Glyph name="ChevronRight" size={16} className="rotate-180" />
        </Link>
        <Link
          href={`${hrefBase}/${next}`}
          className="grid place-items-center size-9 rounded-[var(--radius-chip)] text-muted hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/70"
          aria-label="Nächster Tag"
        >
          <Glyph name="ChevronRight" size={16} />
        </Link>
      </nav>
    </div>
  );
}
