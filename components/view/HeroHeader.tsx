"use client";

import { FadeRise } from "@/components/motion/fade-rise";
import { NumberTicker } from "@/components/motion/number-ticker";
import { Sparkline } from "@/components/charts/sparkline";
import { useViewState } from "@/lib/view-state/context";
import { cn } from "@/lib/cn";
import type { Point, SessionTemplateRef } from "@/runner/v4/types.ts";

/**
 * The page is a DAY, not a pipeline. The hero leads with human framing
 * (greeting + date, plan when present), the always-fresh recovery anchor as
 * the single big number, a live heart rate, and the two populated 14-day
 * trends. Everything degrades gracefully — most of the day the LLM slots are
 * empty, but tier1 is always renderable.
 */
export function HeroHeader() {
  const { view } = useViewState();
  const t1 = view?.tier1;

  if (!t1) {
    return (
      <header>
        <h1 className="text-hero">Übersicht</h1>
      </header>
    );
  }

  const facts = t1.facts_now;
  const k = t1.kpis_today;
  const ctx = t1.context;
  const sleeping = facts.sleeping_in_progress === true;

  const nowMs = facts.now_ms ?? Date.parse(view?.generated_at ?? "") ?? 0;
  const greeting = greetingFor(nowMs);
  const isToday = sameLocalDay(nowMs, view?.period_key ?? "");
  const dateLabel = fmtDate(view?.period_key ?? "");

  // Hero number: recovery anchor post-sleep (RMSSD), else daytime steps.
  const postSleep = k.tst_min != null || k.rmssd_ms != null;
  const hero =
    postSleep && k.rmssd_ms != null
      ? { value: k.rmssd_ms, unit: "ms", label: "RMSSD · Erholung", tone: "hrv" as const }
      : k.steps != null
        ? { value: k.steps, unit: "Schritte", label: "heute", tone: "activity" as const }
        : null;

  const sleepSeries = t1.kpis_14d.sleep_quality_series ?? [];
  const autoSeries = t1.kpis_14d.autonomic_balance_series ?? [];

  return (
    <FadeRise>
      <header className="flex flex-col gap-5">
        {/* headline row */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-hero text-[var(--color-text-strong)]">
              {isToday ? greeting : "Rückblick"}
            </h1>
            <p className="mt-1 text-[0.9375rem] text-[var(--color-text-muted)]">
              {dateLabel}
              {ctx.plan_session_today ? (
                <>
                  {" · "}
                  <span className="text-[var(--color-text)]">
                    {planLabel(ctx.plan_session_today)}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {facts.hr_now != null && !sleeping && isToday ? (
              <LiveHeart bpm={facts.hr_now} />
            ) : null}
            <LagNote lagMin={facts.data_lag_min} sleeping={sleeping} />
          </div>
        </div>

        {/* anchor + trend */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,auto)_1fr] md:items-end">
          {sleeping ? (
            <SleepingAnchor />
          ) : hero ? (
            <div className="flex flex-col gap-1">
              <span className="eyebrow">{hero.label}</span>
              <div className="flex items-baseline gap-2">
                <NumberTicker
                  value={hero.value}
                  className="text-display text-[var(--color-text-strong)]"
                />
                <span className="text-[0.875rem] text-[var(--color-text-subtle)] num-mono">
                  {hero.unit}
                </span>
              </div>
              <SupportFacts
                tst={k.tst_min}
                rhr={k.rhr_sleep_bpm}
                steps={hero.unit === "ms" ? k.steps : null}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="eyebrow">heute</span>
              <span className="text-[1.25rem] text-[var(--color-text-muted)]">
                Noch keine Messwerte
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-x-6 gap-y-3 md:justify-end">
            <TrendCell label="Schlafqualität" tone="sleep" series={sleepSeries} />
            <TrendCell label="Autonome Balance" tone="hrv" series={autoSeries} />
          </div>
        </div>
      </header>
    </FadeRise>
  );
}

function SupportFacts({
  tst,
  rhr,
  steps,
}: {
  tst: number | null;
  rhr: number | null;
  steps: number | null;
}) {
  const parts: string[] = [];
  if (tst != null) parts.push(`Schlaf ${Math.floor(tst / 60)}h${(tst % 60).toString().padStart(2, "0")}`);
  if (rhr != null) parts.push(`RHR ${Math.round(rhr)}`);
  if (steps != null) parts.push(`${Math.round(steps).toLocaleString("de-DE")} Schritte`);
  if (parts.length === 0) return null;
  return (
    <p className="text-[0.8125rem] text-[var(--color-text-subtle)] num">{parts.join(" · ")}</p>
  );
}

function TrendCell({
  label,
  tone,
  series,
}: {
  label: string;
  tone: "sleep" | "hrv";
  series: Point[];
}) {
  const values = series.map((p) => p.value);
  const present = values.filter((v): v is number => v != null);
  if (present.length < 2) return null;
  const last = present[present.length - 1];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow">{label}</span>
        <span className="num text-[0.8125rem] font-semibold text-[var(--color-text)]">
          {Math.round(last)}
        </span>
      </div>
      <Sparkline values={values} tone={tone} width={132} height={32} fill />
      <span className="text-[0.625rem] text-[var(--color-text-faint)]">14 Tage</span>
    </div>
  );
}

function LiveHeart({ bpm }: { bpm: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-2.5 py-1 text-[0.75rem] text-[var(--color-text-muted)]">
      <span
        className="animate-heartbeat inline-block text-[var(--color-heart)]"
        aria-hidden
      >
        ♥
      </span>
      <span className="num font-semibold text-[var(--color-text)]">{Math.round(bpm)}</span>
      <span className="text-[var(--color-text-subtle)]">bpm</span>
    </span>
  );
}

function SleepingAnchor() {
  return (
    <div className="flex items-center gap-3">
      <span className="animate-breathe text-[2rem] text-[var(--color-sleep)]" aria-hidden>
        ☾
      </span>
      <div className="flex flex-col">
        <span className="text-[1.25rem] font-semibold text-[var(--color-text)]">
          Schläft gerade
        </span>
        <span className="text-[0.8125rem] text-[var(--color-text-subtle)]">
          Auswertung folgt nach dem Aufwachen
        </span>
      </div>
    </div>
  );
}

function LagNote({ lagMin, sleeping }: { lagMin: number | null; sleeping: boolean }) {
  if (sleeping || lagMin == null) return null;
  const stale = lagMin > 360;
  const aging = lagMin > 90;
  const label =
    lagMin < 90
      ? `vor ${Math.round(lagMin)} min`
      : lagMin < 360
        ? `vor ${Math.floor(lagMin / 60)}h ${Math.round(lagMin % 60)}m`
        : `veraltet · vor ${Math.floor(lagMin / 60)}h`;
  return (
    <span
      className={cn(
        "text-[0.6875rem]",
        stale
          ? "text-[var(--color-band-down)]"
          : aging
            ? "text-[var(--color-text-subtle)]"
            : "text-[var(--color-text-faint)]",
      )}
    >
      {stale ? null : "aktualisiert "}
      {label}
    </span>
  );
}

function planLabel(p: SessionTemplateRef): string {
  const intensity: Record<SessionTemplateRef["intensity"], string> = {
    recovery: "Erholung",
    easy: "locker",
    moderate: "moderat",
    hard: "hart",
    max: "maximal",
  };
  const kind = p.kind || "Training";
  return `${kind} · ${intensity[p.intensity]} · ${p.duration_min} min`;
}

function greetingFor(ms: number): string {
  const h = new Date(ms).getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Guten Tag";
  if (h < 22) return "Guten Abend";
  return "Gute Nacht";
}

function sameLocalDay(ms: number, periodKey: string): boolean {
  if (!ms || !/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return false;
  const d = new Date(ms);
  const local = `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
  return local === periodKey;
}

function fmtDate(periodKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey);
  if (!m) return periodKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d
    .toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })
    .replace(", ", " · ");
}
