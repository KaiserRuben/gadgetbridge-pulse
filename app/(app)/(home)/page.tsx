import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { getLatestDailyDate } from "@/lib/insights";
import {
  loadDailyV3Bundle,
  loadDailyV3Status,
  loadMorningInsight,
  findLatestSleepPackage,
  findLatestActivityPackage,
  findLatestRecoveryPackage,
  findLatestSleepInsight,
  findLatestActivityInsight,
  findLatestRecoveryInsight,
  findLatestSynthesis,
  findLatestDayScore,
  getLatestCompleteDate,
} from "@/lib/v3-loaders";
import { computeMode, MODE_ACCENT } from "@/lib/dashboard/mode";
import { applyHeroFallback } from "@/lib/dashboard/hero-fallback";

import { HeroV3 } from "@/components/domain/hero-v3";
import { MorningBriefingCard } from "@/components/domain/morning-briefing";
import { DayDetail } from "@/components/dashboard/day-detail";
import { TopActionCard } from "@/components/domain/top-action-card";
import { DomainPointerCard } from "@/components/domain/domain-pointer-card";
import { ContradictionCard } from "@/components/domain/contradiction-card";
import { PostWorkoutCard } from "@/components/domain/post-workout-card";
import { MetricTile } from "@/components/domain/metric-tile";
import { BandStrip } from "@/components/charts/band-strip";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { DayNavigator } from "@/components/nav/day-navigator";
import { fmtInt } from "@/lib/format";
// Nutrition feature flag — flip to `false` (or delete the import + tile) to
// remove the home-page intake ring without touching anything else.
import { IntakeRing } from "@/components/nutrition/IntakeRing";
import { effectiveTarget, getMealsForDate, getTargets, getTodayDate } from "@/lib/nutrition/data";
const FEATURE_NUTRITION_HOME = true;

const TZ = "Europe/Berlin";
const POST_WORKOUT_FRESH_LOOKBACK_HOURS = 6;

const REL_FORMAT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", timeZone: TZ });
function relativeLabel(dateIso: string, todayIso: string): string {
  if (dateIso === todayIso) return "heute";
  const [y, m, d] = dateIso.split("-").map(Number);
  return REL_FORMAT.format(new Date(Date.UTC(y, m - 1, d)));
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ d?: string; t?: string }>;
}) {
  noStore();
  const sp = (await searchParams) ?? {};

  // The unified day-detail surface lives at `/?d=YYYY-MM-DD`. When a valid
  // date is in the query, render that view via the shared `DayDetail`
  // component instead of the today-overview hero. Legacy `/day/[date]`
  // routes redirect into here.
  if (sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d)) {
    const highlightTs = sp.t ? Number(sp.t) : null;
    return (
      <DayDetail
        date={sp.d}
        highlightTs={Number.isFinite(highlightTs) ? highlightTs : null}
      />
    );
  }

  const todayLatest = await getLatestDailyDate();
  if (!todayLatest) return <ColdStart />;

  // ── Pick the date that anchors the hero. Prefer the newest *complete* day;
  //    fall back to the newest folder if nothing is finalised yet.
  const heroDate = (await getLatestCompleteDate()) ?? todayLatest;

  // ── Pull artifacts independently. Each tile can come from a different
  //    date (today's sleep, yesterday's coach). All "find latest" lookups
  //    walk back from the newest folder until they hit data.
  const [
    heroBundleRaw,
    heroStatus,
    sleepLatest,
    activityLatest,
    recoveryLatest,
    sleepInsightLatest,
    activityInsightLatest,
    recoveryInsightLatest,
    synthesisLatest,
    dayScoreLatest,
    morningInsight,
  ] = await Promise.all([
    loadDailyV3Bundle(heroDate),
    loadDailyV3Status(todayLatest),
    findLatestSleepPackage(),
    findLatestActivityPackage(),
    findLatestRecoveryPackage(),
    findLatestSleepInsight(),
    findLatestActivityInsight(),
    findLatestRecoveryInsight(),
    findLatestSynthesis(),
    findLatestDayScore(),
    loadMorningInsight(todayLatest),
  ]);

  // If the hero date doesn't have a synthesis but a more recent one exists in
  // another folder, prefer that (shouldn't happen in practice — synthesis is
  // the last stage — but keeps the hero coherent).
  const heroBundle = applyHeroFallback({
    ...heroBundleRaw,
    daily: heroBundleRaw.daily ?? synthesisLatest?.data ?? null,
    sleep: heroBundleRaw.sleep ?? sleepInsightLatest?.data ?? null,
    activity: heroBundleRaw.activity ?? activityInsightLatest?.data ?? null,
    recovery: heroBundleRaw.recovery ?? recoveryInsightLatest?.data ?? null,
    day_score: heroBundleRaw.day_score ?? dayScoreLatest?.data ?? null,
  });

  // Single timestamp snapshot for the whole render — avoids drift between
  // multiple `Date.now()` calls in mode math, freshness gates, and the
  // morning-briefing pass-through.
  const renderAtMs = Date.now();

  const lastWorkout = activityLatest?.data.today.workouts.at(-1) ?? null;
  const lastWorkoutEndMs = lastWorkout ? new Date(lastWorkout.ts_end_iso).getTime() : null;
  const lastWakeMs = sleepLatest?.data.today.summary.wake_iso
    ? new Date(sleepLatest.data.today.summary.wake_iso).getTime()
    : null;
  const runInProgress =
    !!heroStatus.latest_artifact_mtime_ms &&
    !heroStatus.complete &&
    renderAtMs - heroStatus.latest_artifact_mtime_ms < 30 * 60 * 1000;

  // Morning briefing is keyed to the wake-date folder it lives in. Right now
  // we always read from `todayLatest` — that's the date the card refers to.
  const morningBriefingDate = morningInsight ? todayLatest : null;

  const { mode } = computeMode({
    now_ms: renderAtMs,
    tz: TZ,
    last_workout_end_ms: lastWorkoutEndMs,
    last_wake_ms: lastWakeMs,
    sleep_insight_ready: !!sleepInsightLatest,
    synthesis_ready: !!synthesisLatest,
    day_complete: heroStatus.complete,
    run_in_progress: runInProgress,
  });

  // ── 60-day calendar (unchanged — used by DayNavigator popover) ─────────
  const calendarDates = lastNDates(todayLatest, 60);
  const calendarBundles = await Promise.all(
    calendarDates.map((d) => loadDailyV3Bundle(d).catch(() => null)),
  );
  const daysByDate: Record<
    string,
    {
      date: string;
      band: "above_usual" | "below_usual" | "steady" | null;
      score: number | null;
    }
  > = {};
  calendarDates.forEach((d, i) => {
    const b = calendarBundles[i];
    daysByDate[d] = {
      date: d,
      band: b?.daily?.verdict_band ?? b?.day_score?.band ?? null,
      score: b?.day_score?.value ?? null,
    };
  });

  const showPostWorkout =
    mode === "post-workout" &&
    !!lastWorkout &&
    lastWorkoutEndMs != null &&
    renderAtMs - lastWorkoutEndMs < POST_WORKOUT_FRESH_LOOKBACK_HOURS * 3600 * 1000;

  const synthesis = heroBundle.daily;
  const topAction = synthesis?.top_action_today ?? null;
  const contradictions = synthesis?.contradictions ?? [];
  const pointers = synthesis?.domain_pointers ?? [];

  // 14-day strip (newest right).
  const stripItems = calendarDates
    .slice(0, 14)
    .reverse()
    .map((d) => ({
      date: d,
      band: daysByDate[d]?.band ?? null,
      score: daysByDate[d]?.score ?? null,
    }));

  // ── Metric tiles (sourced from latest-available per domain) ───────────
  // 14-day series oldest→newest for each tile's sparkline. Previously every
  // tile showed the day_score series regardless of which metric the tile's
  // value represented — sparkline lied about its subject. Now each tile gets
  // its own domain KPI trend. Insights expose 3 KPIs per domain; the first
  // one (per schema convention) is the dominant score for that domain.
  const last14 = calendarBundles.slice(0, 14).reverse();

  const pickKpi = (
    insight: { kpis?: Array<{ id: string; value: number | null }> } | null | undefined,
    id: string,
  ): number | null => {
    if (!insight?.kpis) return null;
    const k = insight.kpis.find((x) => x.id === id);
    return k && typeof k.value === "number" ? k.value : null;
  };

  const dayScoreSeries = last14
    .map((b) => b?.day_score?.value ?? null)
    .filter((v): v is number => v != null);

  const sleepKpiSeries = last14
    .map((b) => pickKpi(b?.sleep, "sleep_quality"))
    .filter((v): v is number => v != null);
  const recoveryKpiSeries = last14
    .map((b) => pickKpi(b?.recovery, "autonomic_balance"))
    .filter((v): v is number => v != null);
  const activityKpiSeries = last14
    .map((b) => pickKpi(b?.activity, "volume_load"))
    .filter((v): v is number => v != null);

  const sleepDate = sleepLatest?.date ?? null;
  const activityDate = activityLatest?.date ?? null;
  const dayScoreDate = dayScoreLatest?.date ?? null;
  const recoveryDate = recoveryLatest?.date ?? null;

  const todaySleepEff = sleepLatest?.data.today.summary.sleep_efficiency_pct ?? null;
  const todayTst = sleepLatest?.data.today.summary.tst_min ?? null;
  const todayRmssd = sleepLatest?.data.today.summary.rmssd_ms ?? null;
  const todaySteps = activityLatest?.data.today.steps.total ?? null;
  const todayWorkouts = activityLatest?.data.today.workouts ?? [];
  const recentWorkouts = todayWorkouts.slice(-3).reverse();

  // 7-day workout count: today + last_2_days + days_3_to_7 (was capped at
  // last_2_days, missing every workout >2 days old).
  const workouts7d =
    todayWorkouts.length +
    (activityLatest?.data.last_2_days?.reduce((s, d) => s + d.workout_count, 0) ?? 0) +
    (activityLatest?.data.days_3_to_7?.reduce((s, d) => s + d.workout_count, 0) ?? 0);

  const dayScoreValue = dayScoreLatest?.data.value ?? heroBundle.day_score?.value ?? null;
  const dayScoreBand = dayScoreLatest?.data.band ?? heroBundle.day_score?.band ?? null;

  // Banner: hero comes from past day, today still in progress.
  const showCatchupBanner = heroDate !== todayLatest;
  // Top action competes with the morning briefing for "do this now" attention.
  // Suppress it whenever the morning briefing is showing, or whenever the hero
  // is from a past day (in which case "today" inside top_action is stale).
  const morningBriefingVisible =
    !!morningInsight &&
    !morningInsight.incomplete &&
    !!morningBriefingDate &&
    (morningBriefingDate === todayLatest ||
      (lastWakeMs != null && renderAtMs - lastWakeMs < 18 * 3600 * 1000));
  const showTopAction = !!topAction && heroDate === todayLatest && !morningBriefingVisible;

  // Pretty date label for the catch-up banner — bake the date in plain text
  // so the user knows which day the hero refers to without having to decode
  // "16. Mai" against today.
  const heroDateLabelDe = formatDateDe(heroDate);

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      {/* ── 0. Catch-up banner when hero is a past date ──────────────────
         Promoted from a footnote to a date-anchored banner. The hero card
         below carries confident "Samstag … heute" prose written at finalisation
         time — without a strong banner the reader cannot tell that the prose
         is one day old. */}
      {showCatchupBanner && (
        <Card variant="soft" className="border-[var(--color-border)]">
          <CardBody className="p-4 flex flex-wrap items-center gap-3">
            <Pill tone="low" size="sm">Letzter abgeschlossener Tag</Pill>
            <span className="text-body-sm">
              <span className="font-medium">Analyse für {heroDateLabelDe}.</span>{" "}
              <span className="text-muted">
                Heute ({formatDateDe(todayLatest)}) läuft noch — finale Bewertung nach Tagesende.
              </span>
            </span>
            <Link
              href={`/?d=${todayLatest}`}
              className="ml-auto text-caption hover:text-[var(--color-text)]"
            >
              Heutige Rohdaten →
            </Link>
          </CardBody>
        </Card>
      )}

      {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
      <FadeRise>
        <div className="md:hidden">
          <HeroV3 bundle={heroBundle} date={heroDate} mode={mode} compact />
        </div>
        <div className="hidden md:block">
          <HeroV3 bundle={heroBundle} date={heroDate} mode={mode} />
        </div>
      </FadeRise>

      {/* ── 1.5. Morning briefing — generated on sleep_complete ─────────
         Only show if the briefing was generated for today's wake-date OR
         less than 18h has elapsed since wake (covers same-day reading even
         past midnight). Outside that window the briefing's "tomorrow"-relative
         time anchors no longer make sense. */}
      {morningInsight &&
        !morningInsight.incomplete &&
        morningBriefingDate &&
        (morningBriefingDate === todayLatest ||
          (lastWakeMs != null && Date.now() - lastWakeMs < 18 * 3600 * 1000)) && (
          <FadeRise>
            <MorningBriefingCard
              insight={morningInsight}
              date={morningBriefingDate}
              viewingAtMs={renderAtMs}
            />
          </FadeRise>
        )}

      {/* ── 2. Post-workout fresh card ─────────────────────────────────── */}
      {showPostWorkout && lastWorkout && (
        <FadeRise>
          <PostWorkoutCard
            workout={lastWorkout}
            activityInsight={heroBundle.activity}
            date={activityDate ?? heroDate}
          />
        </FadeRise>
      )}

      {/* ── 3. Top action — only when hero is today AND no morning briefing
         is competing for the "do this now" slot. The morning briefing's
         day_shape is a superset of top_action_today with better time anchoring. */}
      {showTopAction && topAction && (
        <FadeRise>
          <TopActionCard action={topAction} />
        </FadeRise>
      )}

      {/* ── 4. Contradictions ──────────────────────────────────────────── */}
      {contradictions.length > 0 && (
        <Section eyebrow="Konflikte" title={`${contradictions.length} erkannt`}>
          <div className="flex flex-col gap-3">
            {contradictions.map((c, i) => (
              <ContradictionCard key={i} contradiction={c} />
            ))}
          </div>
        </Section>
      )}

      {/* ── 5. 14-day strip + day navigator ───────────────────────────── */}
      <DayNavigator date={todayLatest} daysByDate={daysByDate} hideOnDesktop />
      <FadeRise>
        <Card className="hidden md:block">
          <CardBody className="p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Letzte 14 Tage</span>
              <span className="text-caption text-muted">Tag-Score</span>
            </div>
            <BandStrip items={stripItems} active={todayLatest} hrefBase="/?d=" size={32} />
          </CardBody>
        </Card>
      </FadeRise>

      {/* ── 6. Metric tiles (each sourced from latest-available) ────────
         Section eyebrow used to read "Aktuell · 16. Mai" — misleading,
         because each tile picks its own latest-available date independently.
         Per-tile eyebrows carry the authoritative date. */}
      <Section
        eyebrow="Kennzahlen"
        title="Aktuell"
        trailing={
          <Link
            href={`/?d=${heroDate}`}
            className="text-caption hover:text-[var(--color-text)]"
          >
            Tagesansicht →
          </Link>
        }
      >
        <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3" step={0.05}>
          <StaggerItem>
            <MetricTile
              href={`/sleep/${sleepDate ?? heroDate}`}
              eyebrow={`Schlaf · ${sleepDate ? relativeLabel(sleepDate, todayLatest) : "—"}`}
              icon="Moon"
              tone="sleep"
              value={
                todayTst != null
                  ? `${Math.floor(todayTst / 60)}h${String(todayTst % 60).padStart(2, "0")}`
                  : "—"
              }
              hint={todaySleepEff != null ? `Eff ${todaySleepEff}% · 14d Schlaf-Score` : "14d Schlaf-Score"}
              series={sleepKpiSeries.slice(-10)}
            />
          </StaggerItem>
          <StaggerItem>
            <MetricTile
              href={`/recovery/${recoveryDate ?? heroDate}`}
              eyebrow={`HRV · ${recoveryDate ? relativeLabel(recoveryDate, todayLatest) : "—"}`}
              icon="HeartPulse"
              tone="heart"
              value={todayRmssd != null ? Math.round(todayRmssd) : "—"}
              unit="ms"
              hint="RMSSD Schlaf · 14d Recovery-Score"
              series={recoveryKpiSeries.slice(-10)}
            />
          </StaggerItem>
          <StaggerItem>
            <MetricTile
              href={`/activity/${activityDate ?? heroDate}`}
              eyebrow={`Bewegung · ${activityDate ? relativeLabel(activityDate, todayLatest) : "—"}`}
              icon="Footprints"
              tone="activity"
              value={todaySteps != null ? fmtInt(todaySteps) : "—"}
              hint={`${workouts7d} Workouts 7d · 14d Volume-Score`}
              series={activityKpiSeries.slice(-10)}
            />
          </StaggerItem>
          <StaggerItem>
            <MetricTile
              href={`/?d=${dayScoreDate ?? heroDate}`}
              eyebrow={`Tag-Score · ${dayScoreDate ? relativeLabel(dayScoreDate, todayLatest) : "—"}`}
              icon="Sparkles"
              tone="sleep"
              value={dayScoreValue ?? "—"}
              unit={dayScoreValue != null ? "/100" : undefined}
              hint={dayScoreBand ?? undefined}
              series={dayScoreSeries.slice(-10)}
            />
          </StaggerItem>
        </Stagger>

        {/* ── Nutrition tile — fixtures-only, feature-flagged ────────── */}
        {FEATURE_NUTRITION_HOME && (() => {
          const today = getTodayDate();
          const todayMeals = getMealsForDate(today);
          const todayTotals = todayMeals.reduce(
            (acc, m) => ({
              kcal: acc.kcal + m.totals.kcal,
              protein_g: acc.protein_g + m.totals.protein_g,
              carbs_g: acc.carbs_g + m.totals.carbs_g,
              fat_g: acc.fat_g + m.totals.fat_g,
            }),
            { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
          );
          const targets = getTargets();
          const kcalTarget = effectiveTarget(targets.rows.find((r) => r.key === "kcal")!);
          const proteinTarget = effectiveTarget(targets.rows.find((r) => r.key === "protein_g")!);
          return (
            <Link href="/nutrition" className="block group mt-2 md:mt-3">
              <Card hoverable glow="nutrition">
                <CardBody className="p-4 md:p-5 flex items-center gap-5">
                  <IntakeRing
                    kcal={todayTotals.kcal}
                    kcalTarget={kcalTarget}
                    macros={todayTotals}
                    size="sm"
                  />
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill tone="nutrition" size="sm">Ernährung · heute</Pill>
                      <span className="text-caption text-muted">
                        {todayMeals.length} Mahlzeit{todayMeals.length === 1 ? "" : "en"}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="num text-[1.25rem] font-semibold">
                        {Math.round(todayTotals.protein_g)}
                      </span>
                      <span className="text-subtle text-[0.6875rem] num-mono">
                        / {proteinTarget} g Eiweiß
                      </span>
                      <span className="text-faint">·</span>
                      <span className="num-mono text-caption text-muted">
                        {Math.round(todayTotals.carbs_g)} K · {Math.round(todayTotals.fat_g)} F
                      </span>
                    </div>
                    <span className="text-caption text-subtle opacity-60 group-hover:opacity-100 transition-opacity">
                      Tag öffnen →
                    </span>
                  </div>
                </CardBody>
              </Card>
            </Link>
          );
        })()}
      </Section>

      {/* ── 7. Recent workouts ─────────────────────────────────────────── */}
      {recentWorkouts.length > 0 && (
        <Section
          eyebrow={`Aktivitäten · ${activityDate ? relativeLabel(activityDate, todayLatest) : ""}`}
          title={`${recentWorkouts.length} an diesem Tag · ${workouts7d} in 7 Tagen`}
          trailing={
            <Link
              href={`/activity/${activityDate ?? heroDate}`}
              className="text-caption hover:text-[var(--color-text)]"
            >
              Alle →
            </Link>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
            {recentWorkouts.map((w, i) => (
              <Card key={i} hoverable>
                <CardBody className="p-4 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Glyph name="Dumbbell" size={14} className="text-[var(--color-activity)]" />
                      <span className="eyebrow truncate">{w.name ?? "Workout"}</span>
                    </div>
                    <span className="num-mono text-caption shrink-0">
                      {new Date(w.ts_start_iso).toLocaleTimeString("de-DE", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: TZ,
                      })}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="num text-[1.25rem] font-semibold">{w.duration_min}min</span>
                    {w.distance_m != null && w.distance_m > 0 && (
                      <span className="num-mono text-caption">{(w.distance_m / 1000).toFixed(1)} km</span>
                    )}
                    {w.active_calories != null && (
                      <span className="num-mono text-caption">{Math.round(w.active_calories)} kcal</span>
                    )}
                  </div>
                  {w.workout_load != null && (
                    <span className="text-caption text-muted">Load {w.workout_load}</span>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* ── 8. Domain pointers ─────────────────────────────────────────── */}
      {pointers.length === 3 && (() => {
        const allIncomplete = pointers.every((p) => p.callout === "Daten unvollständig");
        return (
          <Section
            eyebrow="Domänen"
            title="Drill-down"
            trailing={
              <Link href={`/?d=${heroDate}`} className="text-caption hover:text-[var(--color-text)]">
                Tagesansicht →
              </Link>
            }
          >
            {allIncomplete ? (
              <Card variant="soft">
                <CardBody className="p-5 flex flex-col gap-2">
                  <Pill tone="low" size="sm">Daten unvollständig</Pill>
                  <p className="text-body-sm text-muted">
                    Domain-Drill-downs werden nach Tagesende final berechnet. Detail-Seiten zeigen aktuelle Rohdaten.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {pointers.map((p) => (
                      <Link
                        key={p.domain}
                        href={`/${
                          p.domain === "activity" ? "activity" : p.domain === "recovery" ? "recovery" : "sleep"
                        }/${heroDate}`}
                        className="text-caption hover:text-[var(--color-text)] underline decoration-dotted"
                      >
                        {p.label_de} →
                      </Link>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {pointers.map((p, i) => (
                  <DomainPointerCard key={i} pointer={p} date={heroDate} />
                ))}
              </div>
            )}
          </Section>
        );
      })()}

      <details className="text-caption text-muted">
        <summary className="cursor-pointer">Mode debug</summary>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Pill tone="low" size="sm">{mode}</Pill>
          <span>accent: {MODE_ACCENT[mode]}</span>
          <span>· hero: {heroDate}</span>
          <span>· latest: {todayLatest}</span>
          <span>· sleep: {sleepDate ?? "—"}</span>
          <span>· activity: {activityDate ?? "—"}</span>
        </div>
      </details>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

const FULL_DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});

function formatDateDe(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return FULL_DATE_FORMAT.format(new Date(Date.UTC(y, m - 1, d)));
}

function lastNDates(latest: string, n: number): string[] {
  const out: string[] = [];
  const [y, m, d] = latest.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  for (let i = 0; i < n; i++) {
    const dt = new Date(start - i * 86400 * 1000);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
        dt.getUTCDate(),
      ).padStart(2, "0")}`,
    );
  }
  return out;
}

function ColdStart() {
  return (
    <Card>
      <CardBody className="p-6 flex flex-col gap-2">
        <span className="eyebrow">Noch keine Daten</span>
        <h1 className="text-h2">Sync läuft an</h1>
        <p className="text-body-sm text-muted max-w-prose">
          Sobald die erste Tages-Analyse fertig ist, erscheint hier dein
          Tag-Score und die Empfehlungen.
        </p>
      </CardBody>
    </Card>
  );
}

