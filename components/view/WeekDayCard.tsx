import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import type { DaySynthesisPayload } from "@/runner/v4/slots/day-synthesis/types.ts";
import type { SlotEntry } from "@/runner/v4/types.ts";

const DOW_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function WeekDayCard({
  date,
  entry,
}: {
  date: string;
  entry: SlotEntry<DaySynthesisPayload> | null | undefined;
}) {
  const local = new Date(`${date}T12:00:00`);
  const dow = DOW_DE[local.getDay()] ?? "";
  const dayNum = local.getDate();
  const status = entry?.status;
  const payload = entry?.payload ?? null;

  const summary = payload?.summary_short?.trim() ?? "";
  const dash = <p className="text-xs text-[var(--color-text-muted)]">—</p>;
  let body: React.ReactNode;
  if (
    status === "fresh" ||
    status === "aging" ||
    status === "stale" ||
    status === "degraded"
  ) {
    body = summary ? (
      <p className="text-xs leading-snug text-[var(--color-text)]/85">
        {truncate(summary, 80)}
      </p>
    ) : (
      dash
    );
  } else if (status === "abstained") {
    body = (
      <p className="text-xs text-[var(--color-text-muted)]">ausgesetzt</p>
    );
  } else if (status === "scheduled" || status === "computing") {
    body = (
      <div className="space-y-1.5">
        <Skeleton className="h-2.5 w-3/4" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    );
  } else {
    body = dash;
  }

  return (
    <Link
      href={`/day/${date}`}
      className="surface surface-hover flex min-w-[10rem] snap-start flex-col gap-2 rounded-[var(--radius-card)] p-3 md:min-w-0"
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          {dow}
        </span>
        <span className="text-lg font-semibold tabular-nums text-[var(--color-text)]">
          {dayNum}
        </span>
      </header>
      {body}
    </Link>
  );
}
