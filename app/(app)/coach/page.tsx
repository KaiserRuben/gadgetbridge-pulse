import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { loadDaily, getLatestDailyDate } from "@/lib/insights";
import { loadMorningInsight } from "@/lib/v3-loaders";
import { addDays } from "@/lib/time";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyStateCard } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { ArrowNavList } from "@/components/nav/arrow-nav-list";
import { MorningInsightCell } from "@/components/domain/morning-insight-cell";

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  noStore();
  const sp = await searchParams;
  const latest = (await getLatestDailyDate()) ?? null;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : latest;

  if (!date) return <ColdStart />;

  // Server-load the legacy morning_insight.json for the active date — used
  // as DerivedCell `fallbackPayload` so first paint stays populated even
  // before the JobCell row lands. The 14-day history list reads many days
  // at once and stays server-rendered (out of scope for cluster wrapping).
  const morningFallback = await loadMorningInsight(date);

  const last14 = await Promise.all(
    Array.from({ length: 14 }, (_, i) => addDays(date, -i)).map(async (d) => {
      const [dailyForDay, morningForDay] = await Promise.all([
        loadDaily(d),
        loadMorningInsight(d),
      ]);
      return { date: d, daily: dailyForDay, morning: morningForDay };
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <MorningInsightCell
        periodKey={date}
        fallbackPayload={morningFallback}
        variant="full"
      />

      <Section eyebrow="Verlauf" title="Letzte 14 Tage">
        <Card variant="soft">
          <CardBody className="p-3">
            <div className="flex items-center gap-3 px-3 pb-2 text-caption text-muted">
              <span className="w-[88px]">Datum</span>
              <span className="flex-1">Headline</span>
              <span className="hidden sm:inline">Karten</span>
              <span className="w-[42px] text-right" title="Konfidenz der Tagesanalyse">Konfidenz</span>
              <span className="w-[14px]" />
            </div>
            <ArrowNavList className="flex flex-col">
              {last14.map((d) => {
                const score =
                  d.morning?.confidence?.value != null
                    ? Math.round(d.morning.confidence.value * 100)
                    : d.daily
                      ? Math.round((d.daily.confidence?.value ?? 0) * 100)
                      : null;
                const cardCount = d.morning?.levers?.length ?? 0;
                const active = d.date === date;
                return (
                  <li key={d.date}>
                    <Link
                      href={`/coach?date=${d.date}`}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex items-center gap-3 px-3 h-11 rounded-xl outline-none transition-colors
                        focus-visible:ring-2 focus-visible:ring-[var(--color-sleep)] focus-visible:bg-[var(--color-surface-2)]
                        ${active
                          ? "bg-[var(--color-surface-2)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-[var(--color-sleep)]"
                          : "hover:bg-[var(--color-surface-2)]/50"}`}
                    >
                      <span className={`num-mono text-caption w-[88px] ${active ? "text-[var(--color-text)]" : ""}`}>
                        {fmtShort(d.date)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={`text-[0.875rem] truncate block ${active ? "font-medium" : ""}`}>
                          {d.morning?.headline ?? d.daily?.headline ?? "—"}
                        </span>
                      </div>
                      <span className="text-caption hidden sm:inline" title="Anzahl Hebel-Karten an diesem Tag">
                        {cardCount} {cardCount === 1 ? "Karte" : "Karten"}
                      </span>
                      <span
                        className="num-mono text-caption w-[42px] text-right"
                        title="Konfidenz der Tagesanalyse"
                      >
                        {score != null ? `${score}%` : "—"}
                      </span>
                      <Glyph
                        name="ChevronRight"
                        size={14}
                        className={active ? "text-[var(--color-text)]" : "text-faint"}
                      />
                    </Link>
                  </li>
                );
              })}
            </ArrowNavList>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function ColdStart() {
  return (
    <EmptyStateCard
      cause="abstained"
      cluster="morning_insight"
      headline="Noch keine Coaching-Daten"
    />
  );
}

function fmtShort(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "short", day: "numeric", month: "short",
    timeZone: "Europe/Berlin",
  });
}
