"use client";

import Link from "next/link";

import { DerivedCell } from "@/components/derived/DerivedCell";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { InProgressBadge } from "@/components/ui/in-progress-badge";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { CoachTakeaway } from "@/components/coach/coach-takeaway";
import { tConfidenceShort, tDomain } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { MorningInsightPayload } from "@/runner/clusters/morning_insight/types";

type Horizon = MorningInsightPayload["day_shape"][number]["horizon"];

const HORIZON_LABEL_DE: Record<Horizon, string> = {
  morning: "Morgen",
  midday: "Mittag",
  afternoon: "Nachmittag",
  evening: "Abend",
  day: "Tag",
};

const VERDICT_TONE: Record<
  NonNullable<MorningInsightPayload["verdict_band"]>,
  Parameters<typeof Pill>[0]["tone"]
> = {
  above_usual: "up",
  steady: "steady",
  below_usual: "down",
};

const TZ = "Europe/Berlin";

/**
 * Morning briefing surface backed by the `morning_insight` JobCell.
 *
 * Two render paths during the migration window:
 *  1. JobCell path (primary): DerivedCell polls
 *     `/api/jobs/morning_insight/<periodKey>` and renders the briefing
 *     as the LLM finishes.
 *  2. Legacy fallback: when the cell is `never_computed` AND the
 *     server pre-loaded a payload from on-disk `morning_insight.json`,
 *     render that payload directly. The legacy file is still produced
 *     by both the cluster's prose-stage dual-write AND the legacy
 *     `runV3Cluster("morning", …)` caller in v3-orchestrator, so the
 *     existing dashboard surfaces stay alive.
 *
 * Two variants:
 *  - `variant: "full"`    — used on `/coach`. Hero card + lever grid.
 *                            14-day history list is left to the page
 *                            (it reads multiple days, out of scope).
 *  - `variant: "compact"` — used on the home page. Hero card +
 *                            training rec + day_shape + care_for.
 *                            No lever grid (the coach page owns that
 *                            surface).
 */
export function MorningInsightCell({
  periodKey,
  fallbackPayload,
  variant = "full",
  viewingAtMs,
  href = "/coach",
}: {
  periodKey: string;
  fallbackPayload: MorningInsightPayload | null;
  variant?: "full" | "compact";
  /**
   * Server-side `Date.now()` snapshot used by the compact-variant
   * day_shape rendering so horizon staleness math doesn't drift
   * between server-render and client-mount. Required for the compact
   * variant; ignored by the full variant.
   */
  viewingAtMs?: number;
  /** Compact-variant deep link target. */
  href?: string;
}) {
  return (
    <DerivedCell<MorningInsightPayload>
      cluster="morning_insight"
      cellKey={periodKey}
      scope="daily"
      emptyCtaLabel="Briefing anfordern"
      fallback={
        fallbackPayload ? (
          <MorningInsightBody
            payload={fallbackPayload}
            variant={variant}
            periodKey={periodKey}
            viewingAtMs={viewingAtMs ?? Date.now()}
            href={href}
          />
        ) : (
          <MorningInsightSkeleton variant={variant} />
        )
      }
      // qwen3.6 takes ~30-60s for a full morning briefing; poll a bit
      // faster than the default so the user sees the result land.
      activeIntervalMs={1500}
      render={(payload) => (
        <MorningInsightBody
          payload={payload}
          variant={variant}
          periodKey={periodKey}
          viewingAtMs={viewingAtMs ?? Date.now()}
          href={href}
        />
      )}
    />
  );
}

function MorningInsightSkeleton({ variant }: { variant: "full" | "compact" }) {
  return (
    <Card variant="soft">
      <CardBody className="p-5">
        <Eyebrow>{variant === "compact" ? "Morgen-Briefing" : "Coach"}</Eyebrow>
        <p className="text-body-sm text-muted mt-2">
          {variant === "compact"
            ? "Briefing wird vorbereitet …"
            : "Coach-Karten landen mit der nächsten Schlaf-Synchronisation."}
        </p>
      </CardBody>
    </Card>
  );
}

function MorningInsightBody({
  payload,
  variant,
  periodKey,
  viewingAtMs,
  href,
}: {
  payload: MorningInsightPayload;
  variant: "full" | "compact";
  periodKey: string;
  viewingAtMs: number;
  href: string;
}) {
  if (variant === "compact") {
    return <CompactBody payload={payload} date={periodKey} viewingAtMs={viewingAtMs} href={href} />;
  }
  return <FullBody payload={payload} date={periodKey} />;
}

// ── Compact body (home-page card) ───────────────────────────────────────────

function CompactBody({
  payload,
  date,
  viewingAtMs,
  href,
}: {
  payload: MorningInsightPayload;
  date: string;
  viewingAtMs: number;
  href: string;
}) {
  const todayKey = berlinDateKey(viewingAtMs);
  const isSameDay = date === todayKey;
  const hour = berlinHour(viewingAtMs);
  const dateLabel = fmtDateDe(date);
  const eyebrowTitle = `${dateLabel} · Morgen-Briefing${isSameDay ? "" : " (gestern)"}`;

  if (payload.abstain) {
    return (
      <Card variant="soft">
        <CardBody className="p-5 flex items-start gap-3">
          <span className="grid place-items-center size-8 shrink-0 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <Glyph name="Sparkles" size={14} className="text-muted" />
          </span>
          <div className="flex flex-col gap-1 min-w-0">
            <Eyebrow>{dateLabel}</Eyebrow>
            <span className="text-[0.9375rem]">
              {payload.abstain_reason ?? "Keine Empfehlung für diesen Tag."}
            </span>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card glow="sleep">
      <CardBody className="p-5 lg:p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Eyebrow>{eyebrowTitle}</Eyebrow>
          {payload.verdict_band && (
            <Pill tone={VERDICT_TONE[payload.verdict_band]} size="sm">
              {payload.verdict_band === "above_usual"
                ? "über Schnitt"
                : payload.verdict_band === "below_usual"
                  ? "unter Schnitt"
                  : "stabil"}
            </Pill>
          )}
          <Pill tone="steady" size="sm">
            Konfidenz {Math.round((payload.confidence?.value ?? 0) * 100)}%
          </Pill>
        </div>
        {payload.headline && <h2 className="text-h2">{payload.headline}</h2>}
        {payload.summary_long && (
          <p className="text-body text-muted max-w-[64ch]">{payload.summary_long}</p>
        )}

        {payload.training_recommendation.suggested_session_template_id && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Glyph name="Dumbbell" size={14} className="text-[var(--color-activity)]" />
              <span className="text-caption text-muted">Training-Empfehlung</span>
              <Link
                href="/training"
                className="ml-auto text-caption text-[var(--color-activity)] hover:underline"
              >
                Zur Session →
              </Link>
            </div>
            <span className="text-[1rem] font-medium">
              {payload.training_recommendation.suggested_session_template_id}
            </span>
            {payload.training_recommendation.justification_de && (
              <p className="text-caption text-muted leading-snug">
                {payload.training_recommendation.justification_de}
              </p>
            )}
          </div>
        )}

        {payload.day_shape.length > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow>Tagesform</Eyebrow>
            <ul className="flex flex-col gap-1.5">
              {payload.day_shape.map((step, i) => {
                const past = isHorizonPast(step.horizon, hour, isSameDay);
                return (
                  <li
                    key={i}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-opacity",
                      past
                        ? "border-[var(--color-border)]/60 bg-[var(--color-surface-2)]/20 opacity-55"
                        : "border-[var(--color-border)] bg-[var(--color-surface-2)]/40",
                    )}
                  >
                    <Pill tone={past ? "low" : "neutral"} size="sm">
                      {HORIZON_LABEL_DE[step.horizon]}
                      {past ? " · vorbei" : ""}
                    </Pill>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span
                        className={cn(
                          "text-[0.9375rem]",
                          past && "line-through decoration-[var(--color-border)]",
                        )}
                      >
                        {step.action_de}
                      </span>
                      <span className="text-caption text-faint">{step.anchor}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {payload.care_for.length > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow>{isSameDay ? "Achte heute auf" : `Achte am ${dateLabel} auf`}</Eyebrow>
            <ul className="flex flex-col gap-1.5">
              {payload.care_for.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2.5"
                >
                  <Glyph
                    name="AlertTriangle"
                    size={14}
                    className="mt-0.5 text-[var(--color-warn,#b76e00)]"
                  />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-[0.9375rem] font-medium">{item.area_de}</span>
                    <span className="text-caption text-muted">{item.why_de}</span>
                    {item.action_de && <span className="text-caption">{item.action_de}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Link
          href={href}
          className="inline-flex items-center gap-1.5 text-caption text-muted hover:text-[var(--color-text)] transition-colors"
        >
          <Glyph name="ChevronRight" size={14} />
          Coach-Hebel im Detail
        </Link>
      </CardBody>
    </Card>
  );
}

// ── Full body (/coach page hero + lever grid) ───────────────────────────────

function FullBody({ payload, date }: { payload: MorningInsightPayload; date: string }) {
  const cards = payload.levers ?? [];
  const morningMissing = payload.abstain && cards.length === 0;
  const hasContent = !payload.abstain && cards.length > 0;
  const dateLabel = fmtDateDe(date);

  return (
    <div className="flex flex-col gap-8">
      <FadeRise>
        <Card glow="sleep">
          <CardBody className="p-6 lg:p-8 flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Eyebrow>Coach · {dateLabel}</Eyebrow>
              {payload.abstain && <InProgressBadge />}
              {!payload.abstain && (
                <Pill tone="steady" size="sm">
                  Konfidenz {Math.round((payload.confidence?.value ?? 0) * 100)}%
                </Pill>
              )}
            </div>
            <h1 className="text-hero">
              {payload.headline ??
                (payload.abstain
                  ? "Coach-Karten landen mit der nächsten Schlaf-Synchronisation."
                  : "Heute keine Hebel.")}
            </h1>
            {payload.summary_long && (
              <p className="text-body text-muted max-w-[64ch]">{payload.summary_long}</p>
            )}
            {payload.abstain && (
              <p className="text-body text-muted max-w-[64ch]">
                {payload.abstain_reason ??
                  "Der Morgen-Coach feuert direkt nachdem das Wearable die Nacht abgeschlossen hat — Daten zu RMSSD, Schlafphasen und Trainings-Plan fließen dann zusammen."}
              </p>
            )}
            {!payload.abstain && payload.confidence?.value != null && (
              <ConfidenceBar value={payload.confidence.value} className="mt-2" />
            )}
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="Hebel" title={`${cards.length} aktive Karten`}>
        {hasContent ? (
          <Stagger className="grid grid-cols-1 lg:grid-cols-2 gap-3" step={0.06}>
            {cards.map((c, i) => (
              <StaggerItem key={i}>
                <Card>
                  <CardBody className="p-5 flex flex-col gap-3 h-full">
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-2">
                        <Pill tone={c.domain as Parameters<typeof Pill>[0]["tone"]} size="sm">
                          {c.lever}
                        </Pill>
                        <Pill tone="neutral" size="sm">
                          {tDomain(c.domain)}
                        </Pill>
                      </div>
                      <Pill
                        tone={
                          c.confidence === "high"
                            ? "up"
                            : c.confidence === "low"
                              ? "down"
                              : "steady"
                        }
                        size="sm"
                      >
                        {tConfidenceShort(c.confidence)}
                      </Pill>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Eyebrow>Trajektorie</Eyebrow>
                      <p className="text-[0.9375rem] text-muted leading-snug">{c.trajectory}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Eyebrow>Projektion 90 T</Eyebrow>
                      <p className="text-[0.9375rem] text-subtle leading-snug">{c.projection_90d}</p>
                    </div>
                    <CoachTakeaway
                      anchor={c.tiny_next_step.anchor}
                      tiny={c.tiny_next_step.tiny}
                      horizon={c.tiny_next_step.horizon}
                      domain={c.domain as Parameters<typeof CoachTakeaway>[0]["domain"]}
                      className="mt-auto"
                    />
                  </CardBody>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <Card variant="soft">
            <CardBody className="p-5 text-caption">
              {morningMissing
                ? "Morgen-Coach folgt mit der nächsten Schlaf-Synchronisation."
                : payload.abstain
                  ? (payload.abstain_reason ?? "Coach hat sich enthalten — Datenlage zu dünn.")
                  : "Keine Hebel — Datenfenster zu schmal (≥7 Tage Trend nötig)."}
            </CardBody>
          </Card>
        )}
      </Section>
    </div>
  );
}

// ── Time helpers (mirror the legacy MorningBriefingCard) ────────────────────

function fmtDateDe(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });
}

function berlinDateKey(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${y}-${m}-${d}`;
}

function berlinHour(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

/**
 * Day_shape items are written with a specific time-of-day horizon. Once
 * the clock has moved past that horizon, the action's time window has
 * closed — we keep it visible (for context) but de-emphasise it so it
 * doesn't read as a current call to action.
 */
function isHorizonPast(horizon: Horizon, hour: number, isSameDay: boolean): boolean {
  if (!isSameDay) return true;
  switch (horizon) {
    case "morning":
      return hour >= 11;
    case "midday":
      return hour >= 14;
    case "afternoon":
      return hour >= 18;
    case "evening":
      return hour >= 22;
    case "day":
      return false;
  }
}
