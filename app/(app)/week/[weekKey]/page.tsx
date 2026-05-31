import "server-only";
import Link from "next/link";

import { readViewState, detectScope } from "@/lib/view-state/fetcher";
import { ViewStateProvider } from "@/lib/view-state/context";
import { SlotCell } from "@/components/view/SlotCell";
import { WeekDayStrip } from "@/components/view/WeekDayStrip";
import { WeekSynthesisBody } from "@/components/slots/WeekSynthesisBody";
import { fmtWeekRange, shiftWeek, weekDayDate } from "@/lib/week";
import type {
  ViewStateDaily,
  ViewStateWeekly,
} from "@/runner/v4/types.ts";

export const dynamic = "force-dynamic";

export default async function WeekPage({
  params,
}: {
  params: Promise<{ weekKey: string }>;
}) {
  const { weekKey } = await params;
  const scope = detectScope(weekKey);
  if (scope !== "weekly") {
    return (
      <main className="space-y-4">
        <h1 className="text-xl font-semibold">Woche</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          ungültiger Wochen-Key: <code>{weekKey}</code>
        </p>
      </main>
    );
  }

  const dates = Array.from({ length: 7 }, (_, i) => weekDayDate(weekKey, i)!);
  const [weeklyView, ...dailyViews] = await Promise.all([
    readViewState(weekKey),
    ...dates.map((d) => readViewState(d)),
  ]);

  const view = weeklyView as ViewStateWeekly | null;
  const dailies = dailyViews as Array<ViewStateDaily | null>;
  const prev = shiftWeek(weekKey, -1);
  const next = shiftWeek(weekKey, 1);

  return (
    <ViewStateProvider period_key={weekKey} scope="weekly" initial={view}>
      <main className="space-y-6">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <Link
              href="/v4"
              className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              ← Übersicht
            </Link>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Woche {fmtWeekRange(weekKey)}
            </h1>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
              {weekKey}
            </p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href={`/week/${prev ?? weekKey}`}
              className="rounded-[var(--radius-chip)] px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
            >
              ← Vorwoche
            </Link>
            <Link
              href={`/week/${next ?? weekKey}`}
              className="rounded-[var(--radius-chip)] px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
            >
              Nächste Woche →
            </Link>
          </nav>
        </header>

        {view == null ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            view_state für {weekKey} noch nicht geschrieben.
            Daemon (<code>pulse v4-daemon</code>) muss laufen.
          </p>
        ) : (
          <SlotCell
            slot_id="week_synthesis"
            entry={view.slots.week_synthesis}
            title="Wochen-Synthese"
            Body={WeekSynthesisBody}
          />
        )}

        <WeekDayStrip weekKey={weekKey} dailyViews={dailies} />
      </main>
    </ViewStateProvider>
  );
}
