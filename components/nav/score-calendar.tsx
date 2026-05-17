"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Glyph } from "@/components/ui/glyph";

type CalendarDay = {
  date: string; // YYYY-MM-DD
  band: "above_usual" | "below_usual" | "steady" | null;
  score: number | null;
};

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * Mini month calendar with score-banded day cells. Days with a `band` colour
 * the cell, days without (no LLM yet, future) render as a hairline. Tap → day
 * detail page. Self-contained client component; pass `daysByDate` from the
 * server (last ~90 days max).
 */
export function ScoreCalendar({
  active,
  daysByDate,
  hrefBase = "/?d=",
  onPick,
}: {
  active: string;
  daysByDate: Record<string, CalendarDay>;
  hrefBase?: string;
  onPick?: () => void;
}) {
  const [yyyy, mm] = active.split("-").map(Number);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: yyyy, m: mm });

  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCursor(shiftMonth(cursor, -1))}
          className="grid place-items-center size-8 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
          aria-label="Vorheriger Monat"
        >
          <Glyph name="ChevronLeft" size={16} />
        </button>
        <span className="text-title num-mono">
          {monthLabel(cursor.y, cursor.m)}
        </span>
        <button
          type="button"
          onClick={() => setCursor(shiftMonth(cursor, +1))}
          className="grid place-items-center size-8 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
          aria-label="Nächster Monat"
        >
          <Glyph name="ChevronRight" size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="text-caption text-center pb-1">
            {w}
          </span>
        ))}
        {grid.map((cell, i) => {
          if (!cell) return <span key={i} className="aspect-square" />;
          const day = daysByDate[cell.date];
          const isActive = cell.date === active;
          const tone = day ? bandColor(day.band) : null;
          const score = day?.score ?? null;
          return (
            <Link
              key={cell.date}
              href={/[=?&]$/.test(hrefBase) ? `${hrefBase}${cell.date}` : `${hrefBase}/${cell.date}`}
              onClick={onPick}
              aria-current={isActive ? "date" : undefined}
              className={cn(
                "relative aspect-square grid place-items-center rounded-md text-[0.75rem] num-mono transition-colors",
                "ring-1 ring-inset ring-transparent hover:ring-[var(--color-border-strong)]",
                isActive && "ring-[var(--color-text)]/50",
              )}
              style={{
                background: tone ?? "transparent",
                color: tone ? "white" : "var(--color-text-muted)",
              }}
              title={
                day
                  ? `${cell.date}${score != null ? ` · ${score}` : ""}`
                  : cell.date
              }
            >
              {cell.day}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-3 text-caption justify-center">
        <Legend tone="above" label="über" />
        <Legend tone="steady" label="stabil" />
        <Legend tone="below" label="unter" />
      </div>
    </div>
  );
}

function Legend({ tone, label }: { tone: "above" | "steady" | "below"; label: string }) {
  const color =
    tone === "above"
      ? bandColor("above_usual")
      : tone === "below"
        ? bandColor("below_usual")
        : bandColor("steady");
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-sm" style={{ background: color ?? "transparent" }} />
      {label}
    </span>
  );
}

function bandColor(band: CalendarDay["band"]): string | null {
  if (band === "above_usual") return "color-mix(in oklab, var(--color-band-up) 70%, transparent)";
  if (band === "below_usual") return "color-mix(in oklab, var(--color-band-down) 70%, transparent)";
  if (band === "steady") return "color-mix(in oklab, var(--color-band-steady) 50%, transparent)";
  return null;
}

function monthLabel(y: number, m: number): string {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shiftMonth({ y, m }: { y: number; m: number }, delta: number): { y: number; m: number } {
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1 };
}

function buildMonthGrid(y: number, m: number): Array<{ date: string; day: number } | null> {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const dow = (first.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<{ date: string; day: number } | null> = [];
  for (let i = 0; i < dow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date: key, day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
