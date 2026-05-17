"use client";

import Link from "next/link";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { Glyph } from "@/components/ui/glyph";
import { ScoreCalendar } from "@/components/nav/score-calendar";
import { addDays } from "@/lib/time";

type CalendarDay = {
  date: string;
  band: "above_usual" | "below_usual" | "steady" | null;
  score: number | null;
};

/**
 * Persistent day navigator strip. Replaces the home page's static `BarDay`
 * block as the primary day-picking affordance. Arrows step ±1 day; tapping
 * the date pill opens a `ScoreCalendar` sheet for direct jumping.
 *
 * `hrefBase` may be a path prefix (`/day`) or a query-string prefix
 * (`/?d=`). The helper `joinDateHref` picks the right join (auto-slash for
 * paths, no slash for query strings) so the same component serves both
 * the legacy route and the unified home.
 */
export function DayNavigator({
  date,
  daysByDate,
  hrefBase = "/?d=",
  hideOnDesktop = false,
}: {
  date: string;
  daysByDate: Record<string, CalendarDay>;
  hrefBase?: string;
  hideOnDesktop?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const prev = addDays(date, -1);
  const next = addDays(date, +1);

  return (
    <div
      className={
        hideOnDesktop
          ? "lg:hidden flex items-center gap-2"
          : "flex items-center gap-2"
      }
    >
      <Link
        href={joinDateHref(hrefBase, prev)}
        className="grid place-items-center size-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
        aria-label="Vorheriger Tag"
      >
        <Glyph name="ChevronLeft" size={16} />
      </Link>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] px-3"
            aria-label="Datum wählen"
          >
            <Glyph name="Calendar" size={14} className="text-subtle" />
            <span className="text-[0.875rem] font-medium num-mono truncate">
              {fmtPill(date)}
            </span>
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-[var(--color-surface)] border-t border-[var(--color-border)] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl lg:border lg:max-w-md lg:w-full">
            <Dialog.Title className="sr-only">Tag wählen</Dialog.Title>
            <div className="mx-auto h-1 w-10 rounded-full bg-[var(--color-border-strong)] mb-4 lg:hidden" />
            <ScoreCalendar
              active={date}
              daysByDate={daysByDate}
              hrefBase={hrefBase}
              onPick={() => setOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Link
        href={joinDateHref(hrefBase, next)}
        className="grid place-items-center size-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
        aria-label="Nächster Tag"
      >
        <Glyph name="ChevronRight" size={16} />
      </Link>
    </div>
  );
}

function fmtPill(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Berlin",
  });
}

/**
 * Join a date onto an href prefix. Path-shaped prefixes get a `/` separator;
 * query-string prefixes (ending in `=`, `?`, or `&`) get appended directly.
 */
export function joinDateHref(hrefBase: string, date: string): string {
  if (/[=?&]$/.test(hrefBase)) return `${hrefBase}${date}`;
  return `${hrefBase}/${date}`;
}
