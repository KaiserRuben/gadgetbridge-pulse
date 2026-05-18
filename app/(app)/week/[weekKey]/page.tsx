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
import type { WeeklyRecapPayload } from "@/runner/clusters/weekly_recap/types";

import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { Stat } from "@/components/ui/stat";
import { Section } from "@/components/ui/section";
import { BandStrip } from "@/components/charts/band-strip";
import { WeeklyRecapCell } from "@/components/domain/weekly-recap-cell";

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

  // Legacy file-read kept as fallback for the JobCell DerivedCell — until
  // the dual-write window closes and every reader speaks JobCell, the
  // weekly.json on disk is still the source of truth for the first
  // render before the cluster cell exists in PULSE_INSIGHT.
  const weekly = await loadWeekly(weekKey);
  const range = weekDateRange(weekKey);
  if (!range) notFound();

  // Always load 7 days of daily + facts for the strip + aggregate stats.
  const dates = Array.from({ length: 7 }, (_, i) => weekDayDate(weekKey, i)!);
  const [dailies, facts] = await Promise.all([
    Promise.all(dates.map((d) => loadDaily(d))),
    Promise.all(dates.map((d) => loadFacts(d))),
  ]);

  // Map legacy WeeklyRecapV2 → cluster WeeklyRecapPayload so DerivedCell
  // can render the file payload as its initial state. The cluster cell
  // takes over the moment the worker writes the row.
  const fallbackPayload: WeeklyRecapPayload | null = weekly
    ? weeklyV2ToPayload(weekly, weekKey)
    : null;

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

      {/* Trajectory + patterns + streaks + experiment — driven by the
          weekly_recap JobCell. DerivedCell handles polling, cached
          delivery, and the "Erklärung anfordern" CTA when the cell is
          empty. */}
      <WeeklyRecapCell weekKey={weekKey} fallbackPayload={fallbackPayload} />

      {/* Aggregate stats from facts — deterministic, server-rendered. */}
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

      {/* 7-day strip — deterministic, server-rendered. */}
      <Section eyebrow="Tagesverlauf" title="Score je Tag">
        <Card variant="soft">
          <CardBody className="p-5">
            <BandStrip items={stripItems} />
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

/**
 * Map the legacy `weekly.json` payload to the cluster cell's payload
 * shape, used as the seed `fallbackPayload` for `<WeeklyRecapCell>`. The
 * two shapes only differ in `week_key` (added) and `reasoning_trace`
 * (optional on the cluster payload), so the conversion is straight
 * field-copy.
 */
function weeklyV2ToPayload(weekly: WeeklyRecapV2, weekKey: string): WeeklyRecapPayload {
  return {
    week_key: weekKey,
    schema_version: "weekly/v2",
    language: weekly.language,
    reasoning_trace: weekly.reasoning_trace,
    abstain: weekly.abstain,
    abstain_reason: weekly.abstain_reason,
    trajectory_headline: weekly.trajectory_headline,
    chart_refs: [...weekly.chart_refs],
    pattern_callouts: [...weekly.pattern_callouts],
    streaks: [...weekly.streaks],
    personal_best: weekly.personal_best
      ? { ...weekly.personal_best }
      : null,
    personal_worst: weekly.personal_worst
      ? { ...weekly.personal_worst }
      : null,
    micro_experiment: weekly.micro_experiment
      ? { ...weekly.micro_experiment }
      : null,
    confidence: {
      value: weekly.confidence.value,
      calc: weekly.confidence.calc,
      factors: [...weekly.confidence.factors],
    },
  };
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

