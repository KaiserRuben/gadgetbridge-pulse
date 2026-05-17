import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { ScoreRing } from "@/components/ui/score-ring";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { InProgressBadge } from "@/components/ui/in-progress-badge";
import type { DailyV3Bundle, Band } from "@/lib/types/v3";
import type { DashboardMode } from "@/lib/dashboard/mode";
import { MODE_LABEL_DE } from "@/lib/dashboard/mode";

/**
 * V3 hero. Replaces hero-verdict.
 *
 * Score ring shows deterministic day_score (not LLM confidence).
 * Verdict band drives color + tag.
 * Headline + summary come from synthesis (daily_v3.json).
 * Mode label sits in the eyebrow.
 * Confidence is a thin footer bar — never the headline.
 */
export function HeroV3({
  bundle,
  date,
  mode,
  compact = false,
}: {
  bundle: DailyV3Bundle;
  date: string;
  mode: DashboardMode;
  compact?: boolean;
}) {
  const synthesis = bundle.daily;
  const dayScore = bundle.day_score;
  const band: Band | null = synthesis?.verdict_band ?? dayScore?.band ?? null;

  // ── Live (in-progress day, no insights yet) ────────────────────────────
  if (!synthesis && !dayScore) {
    return (
      <Card glow="sleep" className="overflow-hidden">
        <CardBody className={layout(compact)}>
          <ScoreRing score={0} size={ringSize(compact)} />
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Eyebrow>{fmtDay(date)}</Eyebrow>
              <Pill tone="low" size="sm">{MODE_LABEL_DE[mode]}</Pill>
              <InProgressBadge />
            </div>
            <h1 className={compact ? "text-h2" : "text-hero"}>
              Tag läuft noch — Daten sammeln.
            </h1>
            {!compact && (
              <p className="text-body text-muted max-w-[60ch]">
                Schritte, Stress und Schlaf werden weiter aufgezeichnet. Das
                Tages-Insight wird nach Mitternacht final berechnet.
              </p>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }

  // ── Abstain (data quality too low) ─────────────────────────────────────
  if (synthesis?.abstain) {
    return (
      <Card glow="sleep" className="overflow-hidden">
        <CardBody className={layout(compact)}>
          <ScoreRing score={dayScore?.value ?? 0} band={band} size={ringSize(compact)} />
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Eyebrow>{fmtDay(date)}</Eyebrow>
              <Pill tone="low" size="sm">Wenig Signal</Pill>
            </div>
            <h1 className={compact ? "text-h2" : "text-hero"}>
              Heute zu wenig Daten für ein Urteil.
            </h1>
            {!compact && (
              <p className="text-body text-muted max-w-[60ch]">
                {synthesis.abstain_reason ??
                  "Trage deine Uhr länger, oder warte bis die Synchronisation läuft."}
              </p>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────
  const score = dayScore?.value ?? 0;
  const headline = synthesis?.headline ?? "Tag-Score berechnet";
  const summaryShort = synthesis?.summary_short ?? null;
  const summaryLong = synthesis?.summary_long ?? null;
  const confidence = synthesis?.confidence?.value ?? null;
  const glow = bandGlow(band);

  if (compact) {
    return (
      <Card glow={glow}>
        <CardBody className="p-4 flex items-center gap-4">
          <ScoreRing score={score} band={band} size={96} />
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Eyebrow>{fmtDay(date)}</Eyebrow>
              <Pill tone="low" size="sm">{MODE_LABEL_DE[mode]}</Pill>
              <Pill tone={bandTone(band)} size="sm">{bandLabel(band)}</Pill>
            </div>
            <h1 className="text-h2 leading-tight">{headline}</h1>
            {summaryShort && (
              <p className="text-body-sm text-muted">{summaryShort}</p>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card glow={glow}>
      <CardBody className="p-5 md:p-6 lg:p-8 flex flex-col lg:flex-row items-stretch gap-6 lg:gap-10">
        <div className="flex flex-col items-center gap-4 lg:w-[200px] shrink-0">
          <ScoreRing score={score} band={band} size={180} />
          <div className="flex flex-col items-center gap-1.5">
            <Pill tone={bandTone(band)} size="sm">{bandLabel(band)}</Pill>
            {confidence != null && <ConfidenceBar value={confidence} />}
          </div>
        </div>

        <div className="flex flex-col gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Eyebrow>{fmtDay(date)}</Eyebrow>
            <Pill tone="low" size="sm">{MODE_LABEL_DE[mode]}</Pill>
          </div>
          <h1 className="text-hero">{headline}</h1>
          {summaryLong && (
            <p className="text-body text-muted max-w-[64ch]">{summaryLong}</p>
          )}
          {synthesis?.key_insight && (
            <div className="rounded-lg border border-border/60 bg-background/40 p-4 text-body-sm">
              <span className="text-caption text-muted uppercase tracking-wide block mb-1">
                Cross-Domain Insight
              </span>
              {synthesis.key_insight}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function layout(compact: boolean): string {
  return compact
    ? "p-4 flex items-center gap-4"
    : "p-5 md:p-6 lg:p-8 flex flex-col lg:flex-row items-stretch gap-6";
}

function ringSize(compact: boolean): number {
  return compact ? 96 : 180;
}

function bandLabel(b: Band | null): string {
  return b === "above_usual"
    ? "Über Normal"
    : b === "below_usual"
      ? "Unter Normal"
      : b === "steady"
        ? "Stabil"
        : "Wenig Signal";
}

function bandTone(b: Band | null): "up" | "down" | "steady" | "low" {
  return b === "above_usual"
    ? "up"
    : b === "below_usual"
      ? "down"
      : b === "steady"
        ? "steady"
        : "low";
}

function bandGlow(b: Band | null): "activity" | "stress" | "sleep" {
  return b === "above_usual" ? "activity" : b === "below_usual" ? "stress" : "sleep";
}

function fmtDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Berlin",
  });
}
