import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { addDays, windowForDate } from "@/lib/time";
import { getActivityMinutes, getDaySummary } from "@/lib/queries/activity";
import {
  getWorkouts,
  getTrainingLoadAcute,
  getTrainingLoadChronic,
  getAcwrSnapshot,
  workoutTypeIcon,
  workoutTypeLabel,
  type LoadPoint,
} from "@/lib/queries/workouts";
import { stitchWorkouts } from "@/lib/queries/workout-stitch";
import { readEffectiveUserAttributes } from "@/lib/user-attributes";
import { readViewState } from "@/lib/view-state/fetcher";
import { detailToday, detailSeries, detailDates } from "@/lib/view-state/detail";
import type { ViewStateDaily } from "@/runner/v4/types.ts";
import { fmtInt } from "@/lib/format";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Pill } from "@/components/ui/pill";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { BarDay } from "@/components/charts/bar-day";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import {
  StepsVsGoalChart,
  AcwrChart,
  type StepsBar,
  type AcwrPoint,
} from "@/components/charts/activity-charts";
import { FadeRise } from "@/components/motion/fade-rise";
import Link from "next/link";

/** Default daily-step target when the user hasn't configured one. */
const DEFAULT_STEPS_GOAL = 8000;

export default async function ActivityDetail({ params }: { params: Promise<{ date: string }> }) {
  noStore();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const w = windowForDate(date);

  // 28-day load window for ACWR; 30-day workout window for distribution.
  const acwrSince = Math.floor(new Date(addDays(date, -27) + "T00:00:00Z").getTime() / 1000);
  const distSince = Math.floor(new Date(addDays(date, -29) + "T00:00:00Z").getTime() / 1000);

  // Raw activity telemetry + workouts stay direct DB reads; derived daily
  // metrics + 14d trends come from view-state tier1.detail.
  const [mins, summary, workouts, workouts30d, attrs, acuteSeries, chronicSeries, acwrSnapshot, view] =
    await Promise.all([
      Promise.resolve(getActivityMinutes(w)),
      Promise.resolve(getDaySummary(w)),
      Promise.resolve(getWorkouts({ sinceSec: w.since, untilSec: w.until })),
      Promise.resolve(getWorkouts({ sinceSec: distSince, untilSec: w.until, limit: 200 })),
      Promise.resolve(safeReadAttrs()),
      Promise.resolve(getTrainingLoadAcute({ sinceSec: acwrSince, untilSec: w.until })),
      Promise.resolve(getTrainingLoadChronic({ sinceSec: acwrSince, untilSec: w.until })),
      Promise.resolve(getAcwrSnapshot()),
      readViewState(date) as Promise<ViewStateDaily | null>,
    ]);

  const stepsGoal = attrs?.steps_goal_spd ?? DEFAULT_STEPS_GOAL;

  const buckets = bucketStepsByHour(mins);
  const stepsSeries = detailSeries(view, "activity.steps");
  const activeSeries = detailSeries(view, "activity.active_minutes");
  const sedentarySeries = detailSeries(view, "activity.sedentary_minutes");
  const calSeries = detailSeries(view, "activity.calories_kcal");
  const dates14 = detailDates(view, "activity.steps");

  // 14-day Schritte vs Ziel — keep null gaps so the bar renders muted.
  const stepsBars: StepsBar[] = dates14.map((d, i) => ({ date: d, steps: stepsSeries[i] }));
  const goalReachedDays = stepsBars.filter((b) => b.steps != null && b.steps >= stepsGoal).length;
  const dataDays = stepsBars.filter((b) => b.steps != null).length;

  const acwrPoints = mergeAcwrSeries(acuteSeries, chronicSeries);

  const distribution = workoutDistribution(workouts30d);
  const totalWorkouts30d = distribution.reduce((s, r) => s + r.count, 0);
  const totalMinutes30d = distribution.reduce((s, r) => s + r.totalMinutes, 0);

  const stripItems = dates14.map((d, i) => {
    const s = stepsSeries[i];
    return {
      date: d,
      band:
        s == null
          ? null
          : ((s >= stepsGoal ? "above_usual" : s < stepsGoal / 2 ? "below_usual" : "steady") as
              | "above_usual"
              | "below_usual"
              | "steady"),
      score: s == null ? null : Math.min(100, Math.round((s / Math.max(1, stepsGoal)) * 80)),
    };
  });

  const stitchedToday = stitchWorkouts(workouts);
  const latestSession = stitchedToday[0] ?? null;
  const sessionHref = latestSession
    ? latestSession.isStitched
      ? `/activities/${latestSession.id}`
      : `/workouts/${latestSession.primaryId}`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <DomainChrome domainLabel="Bewegung" date={date} hrefBase="/activity" icon="Footprints" />

      <div className="hidden items-center justify-between gap-3 md:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/activity/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">Schritte vs Ziel</span>
      </div>

      <FadeRise>
        <Card glow="activity">
          <CardBody className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4 lg:p-6">
            <Stat label="Schritte" value={fmtInt(summary.totalSteps)} />
            <Stat label="Distanz" value={(summary.totalDistanceM / 1000).toFixed(2)} unit="km" />
            {summary.totalCalories > 0 ? (
              <Stat label="Aktiv-Energie" value={fmtInt(summary.totalCalories)} unit="kcal" />
            ) : (
              <Stat label="Aktiv-Energie" value="—" />
            )}
            <Stat label="Aktiv" value={fmtNum(detailToday(view, "activity.active_minutes"), Math.round)} unit="min" />
          </CardBody>
        </Card>
      </FadeRise>

      {latestSession && sessionHref && (
        <Section eyebrow="Heute" title="Letzte Session">
          <Link href={sessionHref}>
            <Card hoverable glow="activity">
              <CardBody className="flex items-start gap-4 p-5">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-[var(--color-activity)]/40 bg-gradient-to-br from-[var(--color-activity)]/25 to-[var(--color-activity-2)]/15 text-[var(--color-activity)]">
                  <Glyph name={latestSession.typeIcon as GlyphName} size={20} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[1.0625rem] font-medium">{latestSession.typeLabel}</span>
                    <span className="num-mono text-caption">{fmtClock(latestSession.startTs)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-caption">
                    <span className="num-mono">{fmtDur(latestSession.durationSec)}</span>
                    <span className="text-faint">·</span>
                    <span className="num-mono">{(latestSession.distanceM / 1000).toFixed(2)} km</span>
                    <span className="text-faint">·</span>
                    <span className="num-mono">{fmtInt(latestSession.calories)} kcal</span>
                    {latestSession.hrMax != null && (
                      <>
                        <span className="text-faint">·</span>
                        <span className="num-mono">↑{latestSession.hrMax} bpm</span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {latestSession.isStitched && (
                      <Pill tone="activity" size="sm">
                        <Glyph name="GitMerge" size={10} className="mr-1" />
                        {latestSession.members.length} Segmente
                      </Pill>
                    )}
                    {latestSession.workoutLoadSum != null && latestSession.workoutLoadSum > 0 && (
                      <Pill tone="neutral" size="sm" className="num-mono">
                        Last {latestSession.workoutLoadSum}
                      </Pill>
                    )}
                  </div>
                </div>
                <Glyph name="ChevronRight" size={16} className="text-faint self-center" />
              </CardBody>
            </Card>
          </Link>
        </Section>
      )}

      {workouts.length > 1 && (
        <Section eyebrow="Trainings" title={`${workouts.length} aufgezeichnet`}>
          <ul className="flex flex-col gap-2">
            {workouts.map((wk) => (
              <li key={wk.id}>
                <Link href={`/workouts/${wk.id}`}>
                  <Card hoverable>
                    <CardBody className="flex items-center gap-4 p-4">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-activity)]">
                        <Glyph name={workoutTypeIcon(wk.type) as GlyphName} size={18} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[0.9375rem] font-medium">{wk.typeLabel}</span>
                          <span className="num-mono text-caption">{fmtClock(wk.startTs)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-caption">
                          <span className="num-mono">{fmtDur(wk.durationSec)}</span>
                          <span className="text-faint">·</span>
                          <span className="num-mono">{(wk.distanceM / 1000).toFixed(2)} km</span>
                          <span className="text-faint">·</span>
                          <span className="num-mono">{fmtInt(wk.calories)} kcal</span>
                          {wk.aerobicEffect != null && (
                            <Pill tone="activity" size="sm" className="num-mono">
                              aerob {wk.aerobicEffect}
                            </Pill>
                          )}
                        </div>
                      </div>
                      <Glyph name="ChevronRight" size={14} className="text-faint" />
                    </CardBody>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section eyebrow="Tag" title="Schritte pro Stunde">
        <Card>
          <CardBody className="p-5">
            <BarDay buckets={buckets} height={140} />
          </CardBody>
        </Card>
      </Section>

      <Section
        eyebrow="14 Tage"
        title="Schritte vs Ziel"
        trailing={
          <span className="text-caption num-mono text-subtle">
            {goalReachedDays}/{dataDays} erreicht · Ziel {stepsGoal.toLocaleString("de-DE")}
          </span>
        }
      >
        <Card>
          <CardBody className="p-5">
            <StepsVsGoalChart bars={stepsBars} goal={stepsGoal} height={150} />
          </CardBody>
        </Card>
      </Section>

      <Section
        eyebrow="Trainingslast"
        title="ACWR · 28 Tage"
        trailing={
          acwrSnapshot ? (
            <Pill tone={acwrToneFor(acwrSnapshot.band)} size="sm" className="num-mono">
              ACWR {acwrSnapshot.ratio} · {acwrBandLabel(acwrSnapshot.band)}
            </Pill>
          ) : undefined
        }
      >
        <Card>
          <CardBody className="flex flex-col gap-3 p-5">
            <AcwrChart points={acwrPoints} height={220} />
            <div className="flex flex-wrap items-center gap-4 text-caption">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full" style={{ background: "var(--color-activity)" }} aria-hidden />
                Akut (7 Tage)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-px w-3" style={{ background: "var(--color-activity-2)" }} aria-hidden />
                Chronisch (28 Tage)
              </span>
              <span className="text-subtle">Optimaler Bereich 0,8 – 1,3 — Verhältnis akut zu chronisch.</span>
            </div>
          </CardBody>
        </Card>
      </Section>

      <Section
        eyebrow="30 Tage"
        title="Workout-Verteilung"
        trailing={
          <span className="text-caption num-mono text-subtle">
            {totalWorkouts30d} Sessions · {fmtInt(totalMinutes30d)} min
          </span>
        }
      >
        <Card variant="soft">
          <CardBody className="p-5">
            <WorkoutDistributionList rows={distribution} totalMinutes={totalMinutes30d} />
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Trend" title="14 Tage">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TrendTile label="Schritte" series={stepsSeries} />
          <TrendTile label="Aktiv" series={activeSeries} unit="min" />
          <TrendTile label="Sitzend" series={sedentarySeries} unit="min" />
          <TrendTile label="Aktiv-Energie" series={calSeries} unit="kcal" />
        </div>
        <Card variant="soft" className="mt-3 md:hidden">
          <CardBody className="overflow-x-auto p-5">
            <BandStrip items={stripItems} hrefBase="/activity/" active={date} />
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

// ─── workout distribution ──────────────────────────────────────────────────

type DistributionRow = {
  type: number;
  label: string;
  icon: string;
  count: number;
  totalMinutes: number;
};

function workoutDistribution(workouts: ReturnType<typeof getWorkouts>): DistributionRow[] {
  const acc = new Map<number, DistributionRow>();
  for (const w of workouts) {
    const r =
      acc.get(w.type) ?? {
        type: w.type,
        label: workoutTypeLabel(w.type),
        icon: workoutTypeIcon(w.type),
        count: 0,
        totalMinutes: 0,
      };
    r.count += 1;
    r.totalMinutes += Math.round(w.durationSec / 60);
    acc.set(w.type, r);
  }
  return [...acc.values()].sort((a, b) => b.totalMinutes - a.totalMinutes);
}

function WorkoutDistributionList({ rows, totalMinutes }: { rows: DistributionRow[]; totalMinutes: number }) {
  if (rows.length === 0) {
    return <p className="text-caption text-muted">Keine Trainings in den letzten 30 Tagen aufgezeichnet.</p>;
  }
  const maxMinutes = Math.max(1, ...rows.map((r) => r.totalMinutes));
  return (
    <ol className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const widthPct = Math.round((r.totalMinutes / maxMinutes) * 100);
        const sharePct = totalMinutes === 0 ? 0 : Math.round((r.totalMinutes / totalMinutes) * 100);
        return (
          <li key={r.type} className="flex items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-activity)]">
              <Glyph name={r.icon as GlyphName} size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[0.875rem] font-medium">{r.label}</span>
                <span className="text-caption num-mono">
                  {r.count}× · {fmtInt(r.totalMinutes)} min
                </span>
              </div>
              <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, var(--color-activity), var(--color-activity-2))` }}
                />
              </div>
            </div>
            <span className="text-caption num-mono text-subtle w-10 text-right">{sharePct}%</span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── ACWR helpers ──────────────────────────────────────────────────────────

function mergeAcwrSeries(acute: LoadPoint[], chronic: LoadPoint[]): AcwrPoint[] {
  const byDate = new Map<string, AcwrPoint>();
  for (const p of acute) {
    byDate.set(p.dateKey, { date: p.dateKey, acute: p.value, chronic: null, ratio: null });
  }
  for (const p of chronic) {
    const existing = byDate.get(p.dateKey) ?? { date: p.dateKey, acute: null, chronic: null, ratio: null };
    existing.chronic = p.value;
    byDate.set(p.dateKey, existing);
  }
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of out) {
    if (row.acute != null && row.chronic != null && row.chronic > 0) {
      row.ratio = +(row.acute / row.chronic).toFixed(2);
    }
  }
  return out;
}

function acwrToneFor(band: NonNullable<ReturnType<typeof getAcwrSnapshot>>["band"]) {
  return band === "optimal" ? "activity" : band === "deconditioning" ? "down" : band === "high" ? "stress" : "s1";
}

function acwrBandLabel(band: NonNullable<ReturnType<typeof getAcwrSnapshot>>["band"]): string {
  return band === "optimal"
    ? "optimal"
    : band === "deconditioning"
      ? "Trainingslücke"
      : band === "high"
        ? "erhöht"
        : "sehr hoch";
}

// ─── helpers ───────────────────────────────────────────────────────────────

function TrendTile({ label, series, unit }: { label: string; series: Array<number | null>; unit?: string }) {
  const clean = series.filter((v): v is number => v != null);
  const last = clean[clean.length - 1];
  const prev = clean[clean.length - 2];
  const delta = last != null && prev != null ? last - prev : null;
  return (
    <Card>
      <CardBody className="flex min-h-[110px] flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow !text-[10px]">{label}</span>
          {delta != null && (
            <span
              className={`num-mono text-[0.6875rem] ${delta > 0 ? "text-[var(--color-band-up)]" : delta < 0 ? "text-[var(--color-band-down)]" : "text-subtle"}`}
            >
              {delta > 0 ? "+" : delta < 0 ? "−" : ""}
              {Math.abs(Math.round(delta))}
              {unit ?? ""}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="num text-[1.375rem] font-semibold leading-none">{last != null ? fmtInt(last) : "—"}</span>
          {unit && last != null && <span className="text-subtle num-mono text-[0.6875rem]">{unit}</span>}
        </div>
        <Sparkline values={series.slice(-10)} tone="activity" width={160} height={28} className="mt-auto" />
      </CardBody>
    </Card>
  );
}

function bucketStepsByHour(mins: ReturnType<typeof getActivityMinutes>): number[] {
  const buckets = Array.from({ length: 24 }, () => 0);
  for (const r of mins) {
    if (r.steps <= 0) continue;
    const d = new Date(r.ts * 1000);
    const h = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin" }).format(d),
    );
    if (Number.isInteger(h) && h >= 0 && h < 24) buckets[h] += r.steps;
  }
  return buckets;
}

function fmtClock(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m} min`;
}

function fmtNum(v: number | null, fmt: (n: number) => string | number = (n) => n): string {
  if (v == null) return "—";
  return String(fmt(v));
}

function safeReadAttrs(): ReturnType<typeof readEffectiveUserAttributes> | null {
  try {
    return readEffectiveUserAttributes();
  } catch {
    return null;
  }
}
