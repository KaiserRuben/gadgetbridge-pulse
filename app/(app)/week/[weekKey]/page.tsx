import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unstable_noStore as noStore } from "next/cache";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { loadWeekly, loadDaily } from "@/lib/insights";
import { todayKey } from "@/lib/time";
import { isWeekKey, fmtWeekRange, weekDateRange, weekDayDate, shiftWeek, dateToWeekKey } from "@/lib/week";
import { fmtInt } from "@/lib/format";
import type { FactsBundleV2, WeeklyRecapV2 } from "@/lib/types/generated";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { Stat } from "@/components/ui/stat";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { BandStrip } from "@/components/charts/band-strip";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

export default async function WeekPage({
  params,
}: {
  params: Promise<{ weekKey: string }>;
}) {
  noStore();
  const { weekKey } = await params;
  if (weekKey === "current" || weekKey === "now" || weekKey === "aktuell") {
    redirect(`/week/${dateToWeekKey(todayKey())}`);
  }
  if (!isWeekKey(weekKey)) notFound();

  const weekly = await loadWeekly(weekKey);
  const range = weekDateRange(weekKey);
  if (!range) notFound();

  // Always load 7 days of daily + facts for the strip + degraded fallback.
  const dates = Array.from({ length: 7 }, (_, i) => weekDayDate(weekKey, i)!);
  const [dailies, facts] = await Promise.all([
    Promise.all(dates.map((d) => loadDaily(d))),
    Promise.all(dates.map((d) => loadFacts(d))),
  ]);

  const stripItems = dates.map((d, i) => {
    const daily = dailies[i];
    const score = scoreFromFacts(facts[i]);
    const band: "above_usual" | "below_usual" | "steady" | null =
      daily?.verdict_band === "above_usual" || daily?.verdict_band === "below_usual" || daily?.verdict_band === "steady"
        ? daily.verdict_band
        : score == null ? null : score >= 85 ? "above_usual" : score < 75 ? "below_usual" : "steady";
    return {
      date: d,
      score,
      band,
    };
  });

  const aggregate = aggregateWeek(facts);
  const prevWeek = shiftWeek(weekKey, -1);
  const nextWeek = shiftWeek(weekKey, 1);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1 min-w-0">
          <Eyebrow>Woche · {weekKey}</Eyebrow>
          <h1 className="text-hero">{fmtWeekRange(weekKey)}</h1>
        </div>
        <nav className="flex items-center gap-1">
          <Link
            href={`/week/${prevWeek ?? weekKey}`}
            className="grid place-items-center size-9 rounded-[var(--radius-chip)] text-muted hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/70"
            aria-label="Vorherige Woche"
          >
            <Glyph name="ChevronRight" size={16} className="rotate-180" />
          </Link>
          <Link
            href={`/week/${nextWeek ?? weekKey}`}
            className="grid place-items-center size-9 rounded-[var(--radius-chip)] text-muted hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/70"
            aria-label="Nächste Woche"
          >
            <Glyph name="ChevronRight" size={16} />
          </Link>
        </nav>
      </div>

      {/* Trajectory headline (LLM) or aggregate fallback */}
      {weekly && !weekly.abstain ? (
        <FadeRise>
          <Card glow="sleep">
            <CardBody className="p-5 md:p-6 lg:p-8 grid grid-cols-1 md:grid-cols-3 gap-4">
              <TrajectoryTile icon="Moon" tone="sleep" label="Erholung" text={weekly.trajectory_headline.recovery} />
              <TrajectoryTile icon="Footprints" tone="activity" label="Bewegung" text={weekly.trajectory_headline.activity} />
              <TrajectoryTile icon="Waves" tone="stress" label="Stress" text={weekly.trajectory_headline.stress} />
              <div className="md:col-span-3">
                <ConfidenceBar value={weekly.confidence.value} />
              </div>
            </CardBody>
          </Card>
        </FadeRise>
      ) : (
        <FadeRise>
          <Card variant="soft">
            <CardBody className="p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Eyebrow>Aggregat</Eyebrow>
                {weekly?.abstain && <Pill tone="steady" size="sm">Coach pausiert</Pill>}
                {!weekly && <Pill tone="steady" size="sm">Kein Wochen-Insight</Pill>}
              </div>
              <p className="text-body text-muted max-w-[60ch]">
                {weekly?.abstain_reason ?? "Der Wochen-Coach hat noch keinen Recap erzeugt. Aggregat aus Tages-Facts unten."}
              </p>
            </CardBody>
          </Card>
        </FadeRise>
      )}

      {/* Aggregate stats from facts */}
      <Section eyebrow="Aggregat" title={`${aggregate.daysWithData} Tage mit Daten`}>
        <Card>
          <CardBody className="p-5 grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Stat label="Schritte / Tag" value={fmtInt(aggregate.stepsAvg)} />
            <Stat label="Schlaf · Mittel" value={fmtMin(aggregate.sleepAvgMin)} />
            <Stat label="Ruhepuls" value={fmtInt(aggregate.rhrAvg)} unit="bpm" />
            <Stat label="HRV" value={fmtInt(aggregate.hrvAvg)} unit="ms" />
            <Stat label="Stress · ø" value={fmtInt(aggregate.stressAvg)} />
          </CardBody>
        </Card>
      </Section>

      {/* 7-day strip */}
      <Section eyebrow="Tagesverlauf" title="Score je Tag">
        <Card variant="soft">
          <CardBody className="p-5">
            <BandStrip items={stripItems} />
          </CardBody>
        </Card>
      </Section>

      {/* Pattern callouts */}
      {weekly?.pattern_callouts && weekly.pattern_callouts.length > 0 && (
        <Section eyebrow="Muster" title={`${weekly.pattern_callouts.length} wiederholte Beobachtungen`}>
          <Stagger className="grid grid-cols-1 lg:grid-cols-2 gap-3" step={0.05}>
            {weekly.pattern_callouts.map((p) => (
              <StaggerItem key={p.id}>
                <Card>
                  <CardBody className="p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <Pill tone="neutral" size="sm">{p.occurrences}× diese Woche</Pill>
                      <span className="text-caption">{p.domains.join(" · ")}</span>
                    </div>
                    <p className="text-[0.9375rem]">{p.description}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {p.days.map((d) => (
                        <Link
                          key={d}
                          href={`/?d=${d}`}
                          className="num-mono text-caption px-2 py-0.5 rounded-md bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)]"
                        >
                          {fmtMd(d)}
                        </Link>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>
      )}

      {/* Streaks + records */}
      {(weekly?.streaks?.length ?? 0) > 0 || weekly?.personal_best || weekly?.personal_worst ? (
        <Section eyebrow="Höhepunkte" title="Streaks & Rekorde">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {weekly?.streaks?.map((s) => (
              <Card key={s.id}>
                <CardBody className="p-5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Glyph name="Flame" size={16} className="text-[var(--color-stress)]" />
                    <Eyebrow>Streak</Eyebrow>
                  </div>
                  <p className="text-[0.9375rem]">{s.label}</p>
                  <div className="flex items-baseline gap-1.5 mt-auto">
                    <span className="num text-[1.625rem] font-semibold">{s.length_days}</span>
                    <span className="text-caption">Tage · {s.metric_id}</span>
                  </div>
                </CardBody>
              </Card>
            ))}
            {weekly?.personal_best && (
              <Card glow="activity">
                <CardBody className="p-5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Glyph name="Trophy" size={16} className="text-[var(--color-activity)]" />
                    <Eyebrow>Bester Tag</Eyebrow>
                  </div>
                  <Link href={`/?d=${weekly.personal_best.date}`} className="text-[0.9375rem] hover:underline">
                    {weekly.personal_best.metric_id}: <span className="num-mono">{weekly.personal_best.value.toFixed(1)}</span>
                  </Link>
                  {weekly.personal_best.note && (
                    <p className="text-caption text-subtle">{weekly.personal_best.note}</p>
                  )}
                  <span className="text-caption mt-auto">{fmtMd(weekly.personal_best.date)}</span>
                </CardBody>
              </Card>
            )}
            {weekly?.personal_worst && (
              <Card>
                <CardBody className="p-5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Glyph name="Mountain" size={16} className="text-[var(--color-heart)]" />
                    <Eyebrow>Schwerster Tag</Eyebrow>
                  </div>
                  <Link href={`/?d=${weekly.personal_worst.date}`} className="text-[0.9375rem] hover:underline">
                    {weekly.personal_worst.metric_id}: <span className="num-mono">{weekly.personal_worst.value.toFixed(1)}</span>
                  </Link>
                  <p className="text-caption text-subtle">{weekly.personal_worst.action_or_note}</p>
                  <span className="text-caption mt-auto">{fmtMd(weekly.personal_worst.date)}</span>
                </CardBody>
              </Card>
            )}
          </div>
        </Section>
      ) : null}

      {/* Micro-experiment */}
      {weekly?.micro_experiment && (
        <Section eyebrow="Micro-Experiment" title="Hypothese der Woche">
          <Card glow="sleep">
            <CardBody className="p-5 lg:p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Glyph name="Sparkles" size={16} className="text-[var(--color-sleep)]" />
                <Pill tone="sleep" size="sm">{weekly.micro_experiment.duration_days} Tage</Pill>
                <span className="text-caption">Ziel · {weekly.micro_experiment.target_metric_id}</span>
              </div>
              <p className="text-[1.0625rem] leading-snug max-w-[60ch]">{weekly.micro_experiment.hypothesis}</p>
              <ol className="flex flex-col gap-2 text-[0.9375rem]">
                <li className="flex gap-3 items-baseline">
                  <span className="num-mono text-caption text-subtle w-8">Wenn</span>
                  <span>{weekly.micro_experiment.anchor}</span>
                </li>
                <li className="flex gap-3 items-baseline">
                  <span className="num-mono text-caption text-subtle w-8">Dann</span>
                  <span>{weekly.micro_experiment.tiny}</span>
                </li>
                <li className="flex gap-3 items-baseline">
                  <span className="num-mono text-caption text-subtle w-8">Sonst</span>
                  <span className="text-subtle">{weekly.micro_experiment.fallback}</span>
                </li>
              </ol>
            </CardBody>
          </Card>
        </Section>
      )}
    </div>
  );
}

function TrajectoryTile({
  icon, tone, label, text,
}: {
  icon: GlyphName;
  tone: "sleep" | "activity" | "stress";
  label: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={`grid place-items-center size-10 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-${tone})]`}>
        <Glyph name={icon} size={18} />
      </span>
      <div className="flex flex-col gap-1 min-w-0">
        <Eyebrow>{label}</Eyebrow>
        <p className="text-[0.9375rem] leading-snug">{text}</p>
      </div>
    </div>
  );
}

async function loadFacts(date: string): Promise<FactsBundleV2 | null> {
  const p = path.join(INSIGHTS_ROOT, "daily", date, "_facts.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
}

function scoreFromFacts(f: FactsBundleV2 | null): number | null {
  const eff = f?.sleep?.metrics?.sleep_efficiency_pct;
  return typeof eff === "number" ? Math.round(eff) : null;
}

function aggregateWeek(facts: Array<FactsBundleV2 | null>) {
  const present = facts.filter((f): f is FactsBundleV2 => f != null);
  const avg = (xs: Array<number | null | undefined>): number => {
    const ok = xs.filter((v): v is number => typeof v === "number");
    if (ok.length === 0) return 0;
    return ok.reduce((s, v) => s + v, 0) / ok.length;
  };
  const sleepMins = present.map((f) => f.sleep?.metrics?.tst_min);
  const rhrs = present.map((f) => f.cardio?.metrics?.rhr_day_bpm);
  const hrvs = present.map((f) =>
    f.cardio?.hrv_series && f.cardio.hrv_series.length > 0
      ? f.cardio.hrv_series.reduce((s, x) => s + x.value_ms, 0) / f.cardio.hrv_series.length
      : null,
  );
  const stresses = present.map((f) => f.stress?.metrics?.stress_mean);
  const steps = present.map((f) => f.activity?.metrics?.steps);
  return {
    daysWithData: present.length,
    sleepAvgMin: avg(sleepMins),
    rhrAvg: avg(rhrs),
    hrvAvg: avg(hrvs),
    stressAvg: avg(stresses),
    stepsAvg: avg(steps),
  };
}

function fmtMin(min: number): string {
  if (!min || min < 1) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtMd(date: string): string {
  if (!date || date.length < 10) return date;
  const [, m, d] = date.split("-");
  return `${Number(d)}.${Number(m)}.`;
}

// keep WeeklyRecapV2 reference for the bundler
type _ = WeeklyRecapV2;
