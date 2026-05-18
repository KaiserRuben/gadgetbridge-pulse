import "server-only";

import { addDays, sleepWindowForDate, windowForDate } from "@/lib/time";
import { getActivityMinutes, getDaySummary } from "@/lib/queries/activity";
import { getSleepStages, getSleepStats, getStageDurations } from "@/lib/queries/sleep";
import { fmtInt } from "@/lib/format";
import { loadDailyV3Bundle, loadSleepPackage, loadActivityPackage } from "@/lib/v3-loaders";
import { applyHeroFallback } from "@/lib/dashboard/hero-fallback";
import { DateSwipe } from "@/components/nav/date-swipe";
import { computeMode } from "@/lib/dashboard/mode";

import { SynthesisCell } from "@/components/domain/synthesis-cell";
import { DayNavigator } from "@/components/nav/day-navigator";
import { CoachTakeaway } from "@/components/coach/coach-takeaway";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { Timeline, type TimelinePoint } from "@/components/charts/timeline";
import { Hypnogram } from "@/components/charts/hypnogram";
import { StageDonut } from "@/components/charts/stage-donut";
import { BarDay } from "@/components/charts/bar-day";
import { DayPatternBlock } from "@/components/nutrition/DayPatternBlock";
import { getDayNutritionAggregate, getTargets } from "@/lib/nutrition/data";

const TZ = "Europe/Berlin";

/**
 * The day-detail view, reusable from both `/day/[date]` (legacy URL — now a
 * 301-redirect into here via `/?d=…`) and the unified home route which
 * branches on `?d=` to render this same surface. Pure server component.
 */
export async function DayDetail({
  date,
  highlightTs,
  hrefBaseForCalendar = "/?d=",
}: {
  date: string;
  highlightTs?: number | null;
  /**
   * Where the calendar sheet inside `DayNavigator` should link to when the
   * user picks a different date. Defaults to `/?d=` so we keep the user on
   * the unified route.
   */
  hrefBaseForCalendar?: string;
}) {
  const dayWindow = windowForDate(date);
  const sleepWindow = sleepWindowForDate(date);

  const [bundleRaw, sleepPkg, activityPkg, mins, daySummary, stages, stats, stageDurs, calendar] =
    await Promise.all([
      loadDailyV3Bundle(date),
      loadSleepPackage(date),
      loadActivityPackage(date),
      Promise.resolve(getActivityMinutes(dayWindow)),
      Promise.resolve(getDaySummary(dayWindow)),
      Promise.resolve(getSleepStages(sleepWindow)),
      Promise.resolve(getSleepStats(sleepWindow)),
      Promise.resolve(getStageDurations(sleepWindow)),
      loadCalendarDays(date, 90),
    ]);

  const bundle = applyHeroFallback(bundleRaw);

  const lastWorkout = activityPkg?.today.workouts.at(-1) ?? null;
  const lastWorkoutEndMs = lastWorkout ? new Date(lastWorkout.ts_end_iso).getTime() : null;
  const lastWakeMs = sleepPkg?.today.summary.wake_iso
    ? new Date(sleepPkg.today.summary.wake_iso).getTime()
    : null;
  const { mode } = computeMode({
    now_ms: Date.now(),
    tz: TZ,
    last_workout_end_ms: lastWorkoutEndMs,
    last_wake_ms: lastWakeMs,
    sleep_insight_ready: !!bundle.sleep && !bundle.sleep.abstain,
    synthesis_ready: !!bundle.daily && !bundle.daily.abstain,
    day_complete: bundle.complete,
    run_in_progress: false,
  });

  const synthesis = bundle.daily;

  const hrSeries: TimelinePoint[] = mins
    .filter((m) => m.hr > 30 && m.hr < 220)
    .map((m) => ({ ts: m.ts * 1000, v: m.hr }));

  const stepBuckets = bucketStepsByHour(mins);

  const suggestions = collectSuggestions(bundle);

  const prevDate = addDays(date, -1);
  const nextDate = addDays(date, 1);

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <DateSwipe
        prevHref={`${hrefBaseForCalendar}${prevDate}`}
        nextHref={`${hrefBaseForCalendar}${nextDate}`}
      />
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Eyebrow>Tag</Eyebrow>
          </div>
          <h1 className="text-[1.25rem] sm:text-[1.5rem] md:text-[1.625rem] font-semibold tracking-[-0.02em]">
            {fmtDayHeading(date)}
          </h1>
        </div>
        <div className="md:w-72">
          <DayNavigator date={date} daysByDate={calendar} hrefBase={hrefBaseForCalendar} />
        </div>
      </div>

      {/* Phase 3d migration: SynthesisCell wraps Hero + TopAction +
         Contradictions. Domain pointers are intentionally omitted on
         this surface — the day-detail page renders its own per-domain
         drill-down grid below (Schlaf/Herz/Bewegung/Coach), so domain
         pointers would double up. */}
      <SynthesisCell
        periodKey={date}
        fallbackPayload={synthesis ?? null}
        variant="day-detail"
        dayScore={bundle.day_score}
        mode={mode}
      />


      <Stagger className="grid grid-cols-1 lg:grid-cols-2 gap-3" step={0.06}>
        <StaggerItem>
          <Section eyebrow="Schlaf" title="Letzte Nacht">
            <Card glow="sleep">
              <CardBody className="p-5 flex flex-col gap-5">
                <div className="grid grid-cols-[auto_1fr] gap-5 items-center">
                  <StageDonut durations={stageDurs} />
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Tief" value={fmtMin(stageDurs[3])} />
                    <Stat label="REM" value={fmtMin(stageDurs[2])} />
                    <Stat label="Leicht" value={fmtMin(stageDurs[1])} />
                    <Stat label="Wach" value={fmtMin(stageDurs[4])} />
                  </div>
                </div>
                <Hypnogram
                  blocks={stages}
                  windowStart={sleepWindow.since * 1000}
                  windowEnd={sleepWindow.until * 1000}
                />
                {stats && (
                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[var(--color-border)]">
                    <Stat label="Effizienz" value={`${stats.efficiency}`} unit="%" />
                    <Stat label="Latenz" value={fmtMin(stats.latencyMin)} />
                    <Stat label="HRV" value={fmtInt(stats.avgHrv)} unit="ms" />
                  </div>
                )}
              </CardBody>
            </Card>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Herz" title="Verlauf 24h">
            <Card glow="heart">
              <CardBody className="p-5 flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Mittel" value={fmtInt(daySummary.hrAvg || 0)} unit="bpm" />
                  <Stat label="Min" value={fmtInt(daySummary.hrMin || 0)} unit="bpm" />
                  <Stat label="Max" value={fmtInt(daySummary.hrMax || 0)} unit="bpm" />
                </div>
                <Timeline
                  data={hrSeries}
                  tone="heart"
                  unit="bpm"
                  height={180}
                  brush
                  highlightTs={highlightTs ?? undefined}
                />
              </CardBody>
            </Card>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Bewegung" title="Schritte">
            <Card glow="activity">
              <CardBody className="p-5 flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Schritte" value={fmtInt(daySummary.totalSteps)} />
                  <Stat label="Distanz" value={(daySummary.totalDistanceM / 1000).toFixed(2)} unit="km" />
                  {daySummary.totalCalories > 0 ? (
                    <Stat label="Aktiv-Energie" value={fmtInt(daySummary.totalCalories)} unit="kcal" />
                  ) : (
                    <Stat label="Aktiv-Energie" value="—" />
                  )}
                </div>
                <BarDay buckets={stepBuckets} />
              </CardBody>
            </Card>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Coach" title="Empfehlungen aus Cluster-Insights">
            <SuggestionsStack items={suggestions} />
          </Section>
        </StaggerItem>
      </Stagger>

      {/* ── Nutrition aggregate ──────────────────────────────────────── */}
      {(() => {
        const aggregate = getDayNutritionAggregate(date);
        if (!aggregate) return null;
        return (
          <FadeRise>
            <DayPatternBlock data={aggregate} targets={getTargets()} />
          </FadeRise>
        );
      })()}
    </div>
  );
}

type ClusterDomain = "sleep" | "recovery" | "activity";

interface SuggestionItem {
  domain: ClusterDomain;
  anchor: string;
  tiny: string;
  why: string;
  horizon: "today" | "tonight";
}

interface ClusterLike {
  abstain: boolean;
  suggestions_today?: Array<{ anchor: string; tiny: string; why: string; horizon: "today" | "tonight" }>;
}

function collectSuggestions(bundle: Awaited<ReturnType<typeof loadDailyV3Bundle>>): SuggestionItem[] {
  const out: SuggestionItem[] = [];
  const entries: Array<[ClusterDomain, ClusterLike | null]> = [
    ["sleep", bundle.sleep],
    ["recovery", bundle.recovery],
    ["activity", bundle.activity],
  ];
  for (const [domain, c] of entries) {
    if (!c || c.abstain) continue;
    for (const s of c.suggestions_today ?? []) {
      out.push({
        domain,
        anchor: s.anchor,
        tiny: s.tiny,
        why: s.why,
        horizon: s.horizon,
      });
    }
  }
  return out;
}

function SuggestionsStack({ items }: { items: SuggestionItem[] }) {
  if (items.length === 0) {
    return (
      <Card variant="soft">
        <CardBody className="p-5 text-caption">Noch keine Empfehlungen für diesen Tag.</CardBody>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((s, i) => (
        <Card key={i} variant="flat">
          <CardBody className="p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Pill tone={s.domain === "sleep" ? "sleep" : s.domain === "recovery" ? "down" : "up"} size="sm">
                {domainLabelDe(s.domain)}
              </Pill>
              <Pill tone="steady" size="sm">{horizonLabelDe(s.horizon)}</Pill>
            </div>
            <CoachTakeaway
              anchor={s.anchor}
              tiny={s.tiny}
              horizon={s.horizon}
              domain={s.domain as Parameters<typeof CoachTakeaway>[0]["domain"]}
            />
            <p className="text-caption text-muted">{s.why}</p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function domainLabelDe(d: ClusterDomain): string {
  return d === "sleep" ? "Schlaf" : d === "recovery" ? "Erholung" : "Bewegung";
}

function horizonLabelDe(h: "today" | "tonight"): string {
  return h === "today" ? "Heute" : "Heute Nacht";
}

function fmtDayHeading(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Berlin",
  });
}

async function loadCalendarDays(
  end: string,
  n: number,
): Promise<
  Record<string, { date: string; band: "above_usual" | "below_usual" | "steady" | null; score: number | null }>
> {
  const dates: string[] = [];
  for (let i = 0; i < n; i++) dates.push(addDays(end, -i));
  const bundles = await Promise.all(dates.map((d) => loadDailyV3Bundle(d).catch(() => null)));
  const out: Record<string, { date: string; band: "above_usual" | "below_usual" | "steady" | null; score: number | null }> = {};
  dates.forEach((d, i) => {
    const b = bundles[i];
    out[d] = {
      date: d,
      band: b?.daily?.verdict_band ?? b?.day_score?.band ?? null,
      score: b?.day_score?.value ?? null,
    };
  });
  return out;
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
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
