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

import { MorningInsightCell } from "@/components/domain/morning-insight-cell";
import { SynthesisCell } from "@/components/domain/synthesis-cell";
import { PendingInsightsBar, type PendingInsight } from "@/components/domain/pending-insights-bar";
import { DayDetail } from "@/components/dashboard/day-detail";
import { PostWorkoutCard } from "@/components/domain/post-workout-card";
import { MetricTile } from "@/components/domain/metric-tile";
import { BandStrip } from "@/components/charts/band-strip";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { EmptyStateCard } from "@/components/ui/empty-state";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { DayNavigator } from "@/components/nav/day-navigator";
import { fmtInt } from "@/lib/format";
import { ConsentCard } from "@/components/notifications/consent-card";
import {
  maybePromoteToEligible,
  shouldShowSoftCard,
} from "@/lib/notifications/consent";
import { isEngagementCriteriaMet } from "@/lib/notifications/eligible";
import { acceptSoftConsent, declineSoftConsent } from "./_consent-actions";
// Nutrition feature flag — flip to `false` (or delete the import + tile) to
// remove the home-page intake ring without touching anything else.
import { IntakeRing } from "@/components/nutrition/IntakeRing";
import { dayTotals, effectiveTarget, getMealsForDate, getTargets, getTodayDate } from "@/lib/nutrition/data";
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
  searchParams?: Promise<{ d?: string; t?: string; debug?: string }>;
}) {
  noStore();
  const sp = (await searchParams) ?? {};
  const debugMode = sp.debug === "1";

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
  // contradictions + domain_pointers rendered by SynthesisCell, not inline.

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

  // ── Determine which insights are pending (no payload yet). Used to ─
  //    collapse three empty CTA cards into a single PendingInsightsBar.
  const synthesisHasData = synthesis != null;
  const morningCanShow =
    !!morningInsight &&
    !morningInsight.incomplete &&
    !!morningBriefingDate &&
    (morningBriefingDate === todayLatest ||
      (lastWakeMs != null && Date.now() - lastWakeMs < 18 * 3600 * 1000));

  const pendingInsights: PendingInsight[] = [];
  if (!synthesisHasData) {
    pendingInsights.push({
      cluster: "synthesis_v3",
      key: heroDate,
      label: "Tages-Analyse",
    });
  }
  if (!morningCanShow && lastWakeMs != null && Date.now() - lastWakeMs < 18 * 3600 * 1000) {
    pendingInsights.push({
      cluster: "morning_insight",
      key: todayLatest,
      label: "Morgen-Briefing",
    });
  }

  // Consent card visibility: engagement gate (≥1 finalized day + ≥1
  // classified meal) promotes ASK_NEVER → ELIGIBLE_SOFT. Then the state
  // machine decides whether to show — ELIGIBLE_SOFT yes, SOFT_DECLINED
  // after backoff yes, everything else no.
  const consentState = maybePromoteToEligible(isEngagementCriteriaMet());
  const showConsentCard = shouldShowSoftCard(consentState);

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {showConsentCard && (
        <ConsentCard
          onAccept={acceptSoftConsent}
          onDecline={declineSoftConsent}
        />
      )}
      {/* ── 1. Day navigator + 14-day strip (above the fold) ──────────── */}
      <DayNavigator date={todayLatest} daysByDate={daysByDate} hideOnDesktop />
      <div className="hidden md:flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={todayLatest} hrefBase="/?d=" size={22} />
        </div>
        <span className="text-caption text-muted">Tag-Score</span>
      </div>

      {/* ── 2. KPI grid lifted to top — the actual data ──────────────── */}
      <Section
        eyebrow={heroDate === todayLatest ? "Heute" : "Letzte Analyse"}
        title={heroDateLabelDe}
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
          const totalsRaw = dayTotals(today);
          const todayTotals = {
            kcal: totalsRaw.kcal ?? 0,
            protein_g: totalsRaw.protein_g ?? 0,
            carbs_g: totalsRaw.carbs_g ?? 0,
            fat_g: totalsRaw.fat_g ?? 0,
          };
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

      {/* ── 3. Catch-up banner: hero is from past day (compact). */}
      {showCatchupBanner && (
        <EmptyStateCard
          cause="computing"
          cluster="synthesis_v3"
          compact
          headline={`Analyse für ${heroDateLabelDe} läuft`}
          reason={`heute (${formatDateDe(todayLatest)}) noch offen`}
          cta={{ label: "Rohdaten", href: `/?d=${todayLatest}` }}
        />
      )}

      {/* ── 4. Synthesis cell — only render when payload exists. ───────
         Empty state moves to the PendingInsightsBar below to keep the
         page rhythm tight on cold-start days. */}
      {synthesisHasData && (
        <SynthesisCell
          periodKey={heroDate}
          fallbackPayload={synthesis ?? null}
          variant="home"
          dayScore={heroBundle.day_score}
          mode={mode}
          responsive
          topActionSuppressed={!showTopAction}
        />
      )}

      {/* ── 5. Morning briefing — only when within wake window AND has data. */}
      {morningCanShow && morningBriefingDate && (
        <FadeRise>
          <MorningInsightCell
            periodKey={morningBriefingDate}
            fallbackPayload={morningInsight ?? null}
            variant="compact"
            viewingAtMs={renderAtMs}
          />
        </FadeRise>
      )}

      {/* ── 6. Pending insights — collapsed strip instead of 3 empty cards. */}
      {pendingInsights.length > 0 && <PendingInsightsBar items={pendingInsights} />}

      {/* ── 7. Post-workout fresh card ─────────────────────────────────── */}
      {showPostWorkout && lastWorkout && (
        <FadeRise>
          <PostWorkoutCard
            workout={lastWorkout}
            activityInsight={heroBundle.activity}
            date={activityDate ?? heroDate}
          />
        </FadeRise>
      )}

      {/* ── 8. Recent workouts ──────────────────────────────────────────
         U3: section is always rendered. On a sedentary day the body is a
         single `<EmptyStateCard cause="no_data">` so the page rhythm
         doesn't collapse — previously the section disappeared entirely
         when no workouts existed, which made the home page feel emptier
         than it actually is. */}
      <Section
        eyebrow={`Aktivitäten · ${activityDate ? relativeLabel(activityDate, todayLatest) : "—"}`}
        title={
          recentWorkouts.length > 0
            ? `${recentWorkouts.length} an diesem Tag · ${workouts7d} in 7 Tagen`
            : `Keine Aktivitäten · ${workouts7d} in 7 Tagen`
        }
        trailing={
          <Link
            href={`/activity/${activityDate ?? heroDate}`}
            className="text-caption hover:text-[var(--color-text)]"
          >
            Alle →
          </Link>
        }
      >
        {recentWorkouts.length === 0 ? (
          <EmptyStateCard
            cause="no_data"
            headline="Heute keine Aktivitäten aufgezeichnet."
          />
        ) : (
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
        )}
      </Section>

      {/* ── 8. Domain pointers — rendered by SynthesisCell above. */}

      {debugMode && (
        <details className="text-caption text-muted" open>
          <summary className="cursor-pointer">Mode debug (?debug=1)</summary>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <Pill tone="low" size="sm">{mode}</Pill>
            <span>accent: {MODE_ACCENT[mode]}</span>
            <span>· hero: {heroDate}</span>
            <span>· latest: {todayLatest}</span>
            <span>· sleep: {sleepDate ?? "—"}</span>
            <span>· activity: {activityDate ?? "—"}</span>
          </div>
        </details>
      )}
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

