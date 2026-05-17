import "server-only";
import Link from "next/link";

import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { cn } from "@/lib/cn";

import type { MorningInsight } from "@/lib/v3-loaders";

type Horizon = MorningInsight["day_shape"][number]["horizon"];

const HORIZON_LABEL_DE: Record<Horizon, string> = {
  morning: "Morgen",
  midday: "Mittag",
  afternoon: "Nachmittag",
  evening: "Abend",
  day: "Tag",
};

const VERDICT_TONE: Record<NonNullable<MorningInsight["verdict_band"]>, Parameters<typeof Pill>[0]["tone"]> = {
  above_usual: "up",
  steady: "steady",
  below_usual: "down",
};

const TZ = "Europe/Berlin";

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
 * Day_shape items are written with a specific time-of-day horizon. Once the
 * clock has moved past that horizon, the action's time window has closed — we
 * keep it visible (for context) but de-emphasise it so it doesn't read as a
 * current call to action.
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

export function MorningBriefingCard({
  insight,
  date,
  viewingAtMs,
  href = "/coach",
}: {
  insight: MorningInsight;
  /** Wake-date the briefing was generated for (YYYY-MM-DD). */
  date: string;
  /** Server-side `Date.now()` snapshot for staleness math (avoid hydration drift). */
  viewingAtMs: number;
  href?: string;
}) {
  const todayKey = berlinDateKey(viewingAtMs);
  const isSameDay = date === todayKey;
  const hour = berlinHour(viewingAtMs);
  const dateLabel = fmtDateDe(date);
  const eyebrowTitle = `${dateLabel} · Morgen-Briefing${isSameDay ? "" : " (gestern)"}`;
  if (insight.abstain) {
    return (
      <Card variant="soft">
        <CardBody className="p-5 flex items-start gap-3">
          <span className="grid place-items-center size-8 shrink-0 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <Glyph name="Sparkles" size={14} className="text-muted" />
          </span>
          <div className="flex flex-col gap-1 min-w-0">
            <Eyebrow>{dateLabel}</Eyebrow>
            <span className="text-[0.9375rem]">
              {insight.abstain_reason ?? "Keine Empfehlung für diesen Tag."}
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
          {insight.verdict_band && (
            <Pill tone={VERDICT_TONE[insight.verdict_band]} size="sm">
              {insight.verdict_band === "above_usual"
                ? "über Schnitt"
                : insight.verdict_band === "below_usual"
                  ? "unter Schnitt"
                  : "stabil"}
            </Pill>
          )}
          <Pill tone="steady" size="sm">
            Konfidenz {Math.round((insight.confidence?.value ?? 0) * 100)}%
          </Pill>
        </div>
        {insight.headline && <h2 className="text-h2">{insight.headline}</h2>}
        {insight.summary_long && (
          <p className="text-body text-muted max-w-[64ch]">{insight.summary_long}</p>
        )}

        {insight.training_recommendation.suggested_session_template_id && (
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
              {insight.training_recommendation.suggested_session_template_id}
            </span>
            {insight.training_recommendation.justification_de && (
              <p className="text-caption text-muted leading-snug">
                {insight.training_recommendation.justification_de}
              </p>
            )}
          </div>
        )}

        {insight.day_shape.length > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow>Tagesform</Eyebrow>
            <ul className="flex flex-col gap-1.5">
              {insight.day_shape.map((step, i) => {
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
                      <span className={cn("text-[0.9375rem]", past && "line-through decoration-[var(--color-border)]")}>
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

        {insight.care_for.length > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow>{isSameDay ? "Achte heute auf" : `Achte am ${dateLabel} auf`}</Eyebrow>
            <ul className="flex flex-col gap-1.5">
              {insight.care_for.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2.5"
                >
                  <Glyph name="AlertTriangle" size={14} className="mt-0.5 text-[var(--color-warn,#b76e00)]" />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-[0.9375rem] font-medium">{item.area_de}</span>
                    <span className="text-caption text-muted">{item.why_de}</span>
                    {item.action_de && (
                      <span className="text-caption">{item.action_de}</span>
                    )}
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
