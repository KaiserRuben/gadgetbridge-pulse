import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { readManualLog } from "@/lib/manual-log";
import { readFeel } from "@/lib/feel";
import { readJournal } from "@/lib/journal";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { FadeRise } from "@/components/motion/fade-rise";

const QUICK = [
  { href: "/log/weight",  label: "Gewicht",  icon: "Footprints" as GlyphName, hint: "kg, Körperfett, BMI" },
  { href: "/log/feel",    label: "Stimmung", icon: "Sparkles"   as GlyphName, hint: "1–5 Skala + Notiz" },
  { href: "/log/journal", label: "Tagebuch",  icon: "PenLine"    as GlyphName, hint: "Freitext, Tags, Stimmung" },
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
    <div className="flex flex-col gap-8">
      <FadeRise>
        <Section eyebrow="Schnell loggen" title="Was möchtest du festhalten?">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {QUICK.map((q, i) => (
              <Link key={q.href} href={q.href}>
                <Card hoverable className="h-full">
                  <CardBody className="p-5 flex items-start gap-4">
                    <span className="grid place-items-center size-10 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                      <Glyph name={q.icon} size={18} className="text-[var(--color-sleep)]" />
                    </span>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <Eyebrow>{`0${i + 1}`}</Eyebrow>
                      <span className="text-title">{q.label}</span>
                      <span className="text-caption">{q.hint}</span>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </Section>
      </FadeRise>

      <Section eyebrow="Verlauf" title={`${merged.length} Einträge`}>
        <Card variant="soft">
          <CardBody className="p-3">
            {merged.length === 0 ? (
              <div className="p-6 text-caption text-center">Noch keine Einträge.</div>
            ) : (
              <ul className="flex flex-col">
                {merged.map((r, i) => (
                  <li key={i} className="flex items-start gap-3 px-3 py-3 hover:bg-[var(--color-surface-2)]/40 rounded-xl">
                    <span className="num-mono text-caption w-[88px] shrink-0 mt-0.5">{fmt(r.ts)}</span>
                    {r.kind === "manual" && (
                      <div className="flex items-center gap-2 flex-1">
                        <Pill tone="neutral" size="sm">{r.metric}</Pill>
                        <span className="num-mono text-[0.9375rem]">{r.value}{r.unit}</span>
                        {r.note && <span className="text-caption truncate">{r.note}</span>}
                      </div>
                    )}
                    {r.kind === "feel" && (
                      <div className="flex items-center gap-2 flex-1">
                        <Pill tone={r.feel >= 4 ? "up" : r.feel <= 2 ? "down" : "steady"} size="sm">Stimmung {r.feel}</Pill>
                        {r.note && <span className="text-caption truncate">{r.note}</span>}
                      </div>
                    )}
                    {r.kind === "journal" && (
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <span className="text-[0.875rem] truncate">{r.text}</span>
                        {r.tags.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {r.tags.map((t) => <Pill key={t} tone="neutral" size="sm">{t}</Pill>)}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
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
