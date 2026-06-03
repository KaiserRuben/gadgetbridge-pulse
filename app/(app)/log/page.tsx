import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { readManualLog } from "@/lib/manual-log";
import { readFeel } from "@/lib/feel";
import { readJournal } from "@/lib/journal";

import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyStateCard } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconBadge, type IconBadgeTone } from "@/components/ui/icon-badge";
import { type GlyphName } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { NumberTicker } from "@/components/motion/number-ticker";

const QUICK = [
  { href: "/log/weight",  label: "Gewicht",  icon: "Footprints" as GlyphName, tone: "body" as IconBadgeTone,    hint: "kg, Körperfett, BMI" },
  { href: "/log/feel",    label: "Stimmung", icon: "Sparkles"   as GlyphName, tone: "stress" as IconBadgeTone,  hint: "1–5 Skala + Notiz" },
  { href: "/log/journal", label: "Tagebuch", icon: "PenLine"    as GlyphName, tone: "neutral" as IconBadgeTone, hint: "Freitext, Tags, Stimmung" },
];

export default async function LogIndex() {
  noStore();
  const [manual, feel, journal] = await Promise.all([
    Promise.resolve(readManualLog(undefined, 40)),
    Promise.resolve(readFeel(undefined, 40)),
    Promise.resolve(readJournal(undefined, 40)),
  ]);

  type Row =
    | { kind: "manual"; ts: number; metric: string; value: number; unit: string; note: string | null }
    | { kind: "feel";   ts: number; feel: number; note: string | null }
    | { kind: "journal"; ts: number; text: string | null; mood: number | null; tags: string[] };

  const merged: Row[] = [
    ...manual.map((r) => ({ kind: "manual" as const, ts: Date.parse(r.ts_iso), metric: r.metric, value: r.value, unit: r.unit, note: r.note })),
    ...feel.map((r) => ({ kind: "feel" as const, ts: Date.parse(r.ts_iso), feel: r.feel, note: r.note })),
    ...journal.map((r) => ({ kind: "journal" as const, ts: Date.parse(r.ts_iso), text: r.text, mood: r.mood, tags: r.tags })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 60);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Log"
        title="Festhalten"
        sub="Gewicht, Stimmung und Tagebuch — manuell ergänzt"
      />

      <FadeRise>
        <Section eyebrow="Schnell loggen" title="Was möchtest du festhalten?">
          <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {QUICK.map((q, i) => (
              <StaggerItem key={q.href} className="h-full">
                <Link href={q.href} className="block h-full">
                  <Card hoverable className="h-full">
                    <CardBody className="flex items-start gap-4 p-5">
                      <IconBadge icon={q.icon} tone={q.tone} size="md" />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Eyebrow>{`0${i + 1}`}</Eyebrow>
                        <span className="text-title">{q.label}</span>
                        <span className="text-caption">{q.hint}</span>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>
      </FadeRise>

      <Section
        eyebrow="Verlauf"
        title={
          <span className="flex items-baseline gap-1.5">
            <NumberTicker value={merged.length} className="num" />
            <span className="text-body text-muted">Einträge</span>
          </span>
        }
      >
        {merged.length === 0 ? (
          <EmptyStateCard cause="no_data" headline="Noch keine Einträge." />
        ) : (
          <Card variant="soft">
            <CardBody className="p-3">
              <Stagger className="flex flex-col">
                {merged.map((r, i) => (
                  <StaggerItem key={i}>
                    <div className="flex items-start gap-3 rounded-[var(--radius-chip)] px-3 py-3 transition-colors hover:bg-[var(--color-surface-2)]">
                      <span className="num-mono text-caption mt-0.5 w-[88px] shrink-0">{fmt(r.ts)}</span>
                      {r.kind === "manual" && (
                        <div className="flex flex-1 items-center gap-2">
                          <Pill tone="neutral" size="sm">{r.metric}</Pill>
                          <span className="num-mono text-body">{r.value}{r.unit}</span>
                          {r.note && <span className="text-caption truncate">{r.note}</span>}
                        </div>
                      )}
                      {r.kind === "feel" && (
                        <div className="flex flex-1 items-center gap-2">
                          <Pill tone={r.feel >= 4 ? "up" : r.feel <= 2 ? "down" : "steady"} size="sm">Stimmung {r.feel}</Pill>
                          {r.note && <span className="text-caption truncate">{r.note}</span>}
                        </div>
                      )}
                      {r.kind === "journal" && (
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="text-body truncate">{r.text}</span>
                          {r.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {r.tags.map((t) => <Pill key={t} tone="neutral" size="sm">{t}</Pill>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            </CardBody>
          </Card>
        )}
      </Section>
    </div>
  );
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("de-DE", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
