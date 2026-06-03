import "server-only";
import Link from "next/link";

import { readViewState, detectScope } from "@/lib/view-state/fetcher";
import { ViewStateProvider } from "@/lib/view-state/context";
import { SlotCell } from "@/components/view/SlotCell";
import { WeekDayStrip } from "@/components/view/WeekDayStrip";
import { PageHeader } from "@/components/ui/page-header";
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
        <PageHeader
          back={{ href: "/v4", label: "Übersicht" }}
          eyebrow={weekKey}
          title={`Woche ${fmtWeekRange(weekKey)}`}
          trailing={
            <nav className="flex items-center gap-2 text-sm">
              <Link
                href={`/week/${prev ?? weekKey}`}
                className="rounded-[var(--radius-pill)] px-3 py-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-text)]"
              >
                ← Vorwoche
              </Link>
              <Link
                href={`/week/${next ?? weekKey}`}
                className="rounded-[var(--radius-pill)] px-3 py-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-text)]"
              >
                Nächste Woche →
              </Link>
            </nav>
          }
        />

        {view == null ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Für diese Woche liegen noch keine Ergebnisse vor. Schau später
            nochmal vorbei.
          </p>
        ) : (
          <SlotCell
            slot_id="week_synthesis"
            entry={view.slots.week_synthesis}
            title="Wochen-Synthese"
          />
        )}

        <WeekDayStrip weekKey={weekKey} dailyViews={dailies} />
      </main>
    </ViewStateProvider>
  );
}
