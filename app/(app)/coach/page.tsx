import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { loadDaily, getLatestDailyDate } from "@/lib/insights";
import { loadMorningInsight } from "@/lib/v3-loaders";
import { addDays } from "@/lib/time";

import { tConfidenceShort, tDomain } from "@/lib/i18n";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { InProgressBadge } from "@/components/ui/in-progress-badge";
import { ArrowNavList } from "@/components/nav/arrow-nav-list";
import { CoachTakeaway } from "@/components/coach/coach-takeaway";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

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

  const [daily, morning] = await Promise.all([
    loadDaily(date),
    loadMorningInsight(date),
  ]);
  const last14 = await Promise.all(
    Array.from({ length: 14 }, (_, i) => addDays(date, -i)).map(async (d) => {
      const [dailyForDay, morningForDay] = await Promise.all([
        loadDaily(d),
        loadMorningInsight(d),
      ]);
      return { date: d, daily: dailyForDay, morning: morningForDay };
    }),
  );

  // Coach cards now come from the morning briefing, which fires on
  // sleep_complete (was: Stage 5 at day_end). `daily.coaching_cards` is no
  // longer populated; the field stays in the schema only so historical
  // daily.json files keep validating.
  const cards = morning?.levers ?? [];
  const morningMissing = !morning;
  const hasContent = !morningMissing && !morning?.abstain && cards.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <FadeRise>
        <Card glow="sleep">
          <CardBody className="p-6 lg:p-8 flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Eyebrow>Coach · {fmtDay(date)}</Eyebrow>
              {!morning && <InProgressBadge />}
              {morning && (
                <Pill tone="steady" size="sm">
                  Konfidenz {Math.round((morning.confidence?.value ?? 0) * 100)}%
                </Pill>
              )}
            </div>
            <h1 className="text-hero">
              {morning?.headline ??
                (!morning
                  ? "Coach-Karten landen mit der nächsten Schlaf-Synchronisation."
                  : "Heute keine Hebel.")}
            </h1>
            {morning?.summary_long && (
              <p className="text-body text-muted max-w-[64ch]">{morning.summary_long}</p>
            )}
            {!morning && (
              <p className="text-body text-muted max-w-[64ch]">
                Der Morgen-Coach feuert direkt nachdem das Wearable die Nacht abgeschlossen hat — Daten zu RMSSD, Schlafphasen und Trainings-Plan fließen dann zusammen.
              </p>
            )}
            {morning?.confidence?.value != null && (
              <ConfidenceBar value={morning.confidence.value} className="mt-2" />
            )}
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="Hebel" title={`${cards.length} aktive Karten`}>
        {hasContent ? (
          <Stagger className="grid grid-cols-1 lg:grid-cols-2 gap-3" step={0.06}>
            {cards.map((c, i) => (
              <StaggerItem key={i}>
                <Card>
                  <CardBody className="p-5 flex flex-col gap-3 h-full">
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-2">
                        <Pill tone={c.domain as Parameters<typeof Pill>[0]["tone"]} size="sm">{c.lever}</Pill>
                        <Pill tone="neutral" size="sm">{tDomain(c.domain)}</Pill>
                      </div>
                      <Pill tone={c.confidence === "high" ? "up" : c.confidence === "low" ? "down" : "steady"} size="sm">
                        {tConfidenceShort(c.confidence)}
                      </Pill>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Eyebrow>Trajektorie</Eyebrow>
                      <p className="text-[0.9375rem] text-muted leading-snug">{c.trajectory}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Eyebrow>Projektion 90 T</Eyebrow>
                      <p className="text-[0.9375rem] text-subtle leading-snug">{c.projection_90d}</p>
                    </div>
                    <CoachTakeaway
                      anchor={c.tiny_next_step.anchor}
                      tiny={c.tiny_next_step.tiny}
                      horizon={c.tiny_next_step.horizon}
                      domain={c.domain as Parameters<typeof CoachTakeaway>[0]["domain"]}
                      className="mt-auto"
                    />
                  </CardBody>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <Card variant="soft">
            <CardBody className="p-5 text-caption">
              {morningMissing
                ? "Morgen-Coach folgt mit der nächsten Schlaf-Synchronisation."
                : morning?.abstain
                  ? (morning.abstain_reason ?? "Coach hat sich enthalten — Datenlage zu dünn.")
                  : "Keine Hebel — Datenfenster zu schmal (≥7 Tage Trend nötig)."}
            </CardBody>
          </Card>
        )}
      </Section>

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
    <Card>
      <CardBody className="p-8 flex flex-col gap-3">
        <Eyebrow>Coach</Eyebrow>
        <h1 className="text-hero">Noch keine Coaching-Daten</h1>
        <p className="text-body text-muted max-w-[60ch]">
          Sobald der Runner einen Tagesinsight schreibt, erscheint hier die Strategie.
        </p>
      </CardBody>
    </Card>
  );
}

function fmtDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long",
    timeZone: "Europe/Berlin",
  });
}

function fmtShort(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "short", day: "numeric", month: "short",
    timeZone: "Europe/Berlin",
  });
}
