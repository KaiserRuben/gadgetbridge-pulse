"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";

import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { useMotionPrefs } from "@/components/motion/_lib";
import { SlotCell } from "./SlotCell";
import { NextRefreshIndicator } from "./NextRefreshIndicator";
import { useViewState } from "@/lib/view-state/context";
import { cn } from "@/lib/cn";
import type {
  SessionTemplateRef,
  SlotEntry,
  SlotStatus,
  ViewStateDaily,
  ViewStateDailySlots,
} from "@/runner/v4/types.ts";

type Domain = NonNullable<Parameters<typeof SlotCell>[0]["domain"]>;

interface SlotMeta {
  id: keyof ViewStateDailySlots;
  title: string;
  eyebrow: string;
  domain?: Domain;
  purpose: string;
  terminal?: boolean;
  /** Domain detail page this slot drills into, e.g. "/sleep". */
  detailBase?: string;
  detailLabel?: string;
}

const SLOTS: SlotMeta[] = [
  {
    id: "night_review",
    title: "Nacht-Review",
    eyebrow: "Letzte Nacht",
    domain: "sleep",
    purpose: "Fasst deine letzte Nacht zusammen — Schlaf, Erholung, Bereitschaft.",
    detailBase: "/sleep",
    detailLabel: "Schlaf-Daten",
  },
  {
    id: "morning_briefing",
    title: "Morgen-Brief",
    eyebrow: "Heute früh",
    domain: "heart",
    purpose: "Setzt den Ton für den Tag — Fokus und Intensität.",
    detailBase: "/heart",
    detailLabel: "Herz-Daten",
  },
  {
    id: "midday_check",
    title: "Mittags-Check",
    eyebrow: "Tagverlauf",
    domain: "stress",
    purpose: "Kurzer Status zur Tagesmitte — wie läuft der Tag bisher.",
    detailBase: "/stress",
    detailLabel: "Stress-Daten",
  },
  {
    id: "evening_review",
    title: "Abend-Review",
    eyebrow: "Tag bisher",
    domain: "activity",
    purpose: "Aktivität, Last und autonome Balance des Tages.",
    detailBase: "/activity",
    detailLabel: "Bewegungs-Daten",
  },
  {
    id: "day_synthesis",
    title: "Tages-Synthese",
    eyebrow: "Reflexion",
    purpose: "Die Geschichte deines Tages — und der Fokus für morgen.",
    terminal: true,
  },
];

export function DayTimeline() {
  const { view } = useViewState();
  const prefs = useMotionPrefs();
  if (!view || view.scope !== "daily") return null;
  const daily = view as ViewStateDaily;
  const slots = daily.slots as ViewStateDailySlots;
  const nowMs = daily.tier1?.facts_now?.now_ms ?? 0;

  // The "now" node = the latest slot whose scheduled time has passed.
  let nowIndex = 0;
  SLOTS.forEach((meta, i) => {
    const sf = slots[meta.id]?.scheduled_for;
    const t = sf ? Date.parse(sf) : NaN;
    if (!Number.isNaN(t) && t <= nowMs) nowIndex = i;
  });

  return (
    <div className="relative">
      {/* the rail — draws in behind the nodes */}
      <motion.div
        aria-hidden
        className="absolute left-[7px] top-3 bottom-3 w-px bg-gradient-to-b from-[var(--color-border)] via-[var(--color-border)] to-transparent"
        style={{ transformOrigin: "top" }}
        initial={{ scaleY: prefs.reduce ? 1 : 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
      />

      <Stagger delay={0.06} className="flex flex-col gap-5">
        {SLOTS.map((meta, i) => {
          const entry = slots[meta.id] as SlotEntry<unknown>;
          const isNow = i === nowIndex;
          return (
            <StaggerItem key={meta.id}>
              <div className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-3.5">
                <div className="relative flex justify-center pt-[18px]">
                  <Dot
                    status={entry?.status ?? "scheduled"}
                    domain={meta.domain}
                    isNow={isNow}
                    terminal={meta.terminal}
                  />
                  {isNow ? (
                    <span className="absolute -left-1 top-0 text-[0.5rem] uppercase tracking-[0.12em] text-[var(--color-text-faint)]">
                      jetzt
                    </span>
                  ) : null}
                </div>
                <SlotCell
                  slot_id={meta.id}
                  entry={entry}
                  title={meta.title}
                  eyebrow={meta.eyebrow}
                  purpose={meta.purpose}
                  domain={meta.domain}
                  isNow={isNow}
                  isTerminal={meta.terminal}
                  detailHref={
                    meta.detailBase ? `${meta.detailBase}/${daily.period_key}` : undefined
                  }
                  detailLabel={meta.detailLabel}
                />
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>

      {/* Door into the full per-day breakdown — the only surface that renders
          the complete slot narrative, hypnogram, KPI/suggestion reasoning and
          sources. The slot cards above drill sideways into domain telemetry;
          this drills *down* into the day itself. */}
      <Link
        href={`/day/${daily.period_key}`}
        className="group mt-5 ml-[30px] inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-3 py-1.5 text-[0.8125rem] text-[var(--color-text-muted)] ring-1 ring-inset ring-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
      >
        Tagesdetail öffnen
        <span className="transition-transform group-hover:translate-x-0.5">→</span>
      </Link>
    </div>
  );
}

const DOT_FILL: Partial<Record<SlotStatus, string>> = {
  fresh: "filled",
  aging: "filled",
  stale: "filled",
  degraded: "filled",
  computing: "pulse",
  errored: "error",
};

function Dot({
  status,
  domain,
  isNow,
  terminal,
}: {
  status: SlotStatus;
  domain?: Domain;
  isNow?: boolean;
  terminal?: boolean;
}) {
  const prefs = useMotionPrefs();
  const kind = DOT_FILL[status] ?? "hollow";
  const size = terminal ? 14 : 10;

  const color =
    kind === "error"
      ? "var(--color-tier-s1)"
      : kind === "pulse"
        ? "var(--color-activity)"
        : domain
          ? domainVar(domain)
          : "var(--color-band-steady)";

  const base: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: kind === "hollow" ? "var(--color-bg-elevated)" : color,
    borderColor: kind === "hollow" ? "var(--color-border-strong)" : color,
  };

  return (
    <motion.span
      className={cn(
        "z-10 inline-block rounded-full border-2",
        kind === "pulse" && "now-dot",
        isNow && kind !== "pulse" && "now-dot",
      )}
      style={base}
      initial={{ scale: prefs.reduce ? 1 : 0.4, opacity: prefs.reduce ? 1 : 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
    />
  );
}

function domainVar(d: Domain): string {
  switch (d) {
    case "sleep":
      return "var(--color-sleep)";
    case "heart":
      return "var(--color-heart)";
    case "activity":
      return "var(--color-activity)";
    case "stress":
      return "var(--color-stress)";
    case "body":
      return "var(--color-temp)";
    case "nutrition":
      return "var(--color-nutrition)";
    default:
      return "var(--color-band-steady)";
  }
}

/** Right-hand "at a glance" rail — plan, anomalies count, pipeline status. */
export function GlanceAside() {
  const { view, connected } = useViewState();
  if (!view) return null;
  const t1 = view.tier1;
  const ctx = t1?.context;
  const health = view.meta?.pipeline_health ?? "stalled";
  const anomalyList = ctx?.anomalies_today ?? [];
  // warn/critical surface in the PriorityBanner up top; the quiet info-level
  // ones have no other home, so list them here by headline.
  const infoAnomalies = anomalyList.filter((a) => a.severity === "info");

  const healthLabel: Record<string, string> = {
    ok: "läuft",
    degraded: "verzögert",
    stalled: "gestoppt",
  };
  const healthColor: Record<string, string> = {
    ok: "var(--color-band-up)",
    degraded: "var(--color-tier-s2)",
    stalled: "var(--color-tier-s1)",
  };

  return (
    <aside className="flex flex-col gap-3">
      <div className="surface-soft flex flex-col gap-2 rounded-[var(--radius-card)] p-4">
        <span className="eyebrow">Plan heute</span>
        <span className="text-[0.875rem] text-[var(--color-text)]">
          {ctx?.plan_session_today
            ? planLabel(ctx.plan_session_today)
            : "Kein Training geplant"}
        </span>
      </div>

      <div className="surface-soft flex flex-col gap-2.5 rounded-[var(--radius-card)] p-4">
        <span className="eyebrow">Status</span>
        <StatusRow color={healthColor[health]} pulse={health === "ok" && connected}>
          Pipeline {healthLabel[health]}
          {connected ? null : " · offline"}
        </StatusRow>
        {anomalyList.length === 0 ? (
          <StatusRow color="var(--color-band-up)">Keine Auffälligkeiten</StatusRow>
        ) : (
          <>
            <StatusRow color="var(--color-tier-s2)">
              {anomalyList.length}{" "}
              {anomalyList.length === 1 ? "Auffälligkeit" : "Auffälligkeiten"}
            </StatusRow>
            {infoAnomalies.map((a, i) => (
              <span
                key={`${a.code}-${i}`}
                className="flex items-start gap-2 pl-0.5 text-[0.75rem] text-[var(--color-text-subtle)]"
              >
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-band-low)]" />
                {a.headline_de}
              </span>
            ))}
          </>
        )}
        <NextRefreshIndicator className="pt-0.5 text-[0.6875rem] text-[var(--color-text-subtle)]" />
      </div>
    </aside>
  );
}

function StatusRow({
  color,
  pulse,
  children,
}: {
  color: string;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 text-[0.8125rem] text-[var(--color-text-muted)]">
      <span
        className={cn("h-2 w-2 rounded-full", pulse && "animate-breathe")}
        style={{ backgroundColor: color }}
      />
      {children}
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
  return `${p.kind || "Training"} · ${intensity[p.intensity]} · ${p.duration_min} min`;
}
