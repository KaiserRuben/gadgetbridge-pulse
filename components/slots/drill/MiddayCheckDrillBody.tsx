"use client";

import { Pill } from "@/components/ui/pill";
import { Confidence } from "@/components/ui/confidence";
import { AbstainNote } from "@/components/slots/_AbstainNote";
import { StressHourly } from "@/components/charts/stress-hourly";
import { DrillSuggestionCard } from "./DrillSuggestionCard";
import type {
  MiddayCheckPayload,
  MiddayStatusLabel,
} from "@/runner/v4/slots/midday-check/types.ts";

const statusTone: Record<MiddayStatusLabel, Parameters<typeof Pill>[0]["tone"]> =
  {
    on_track: "up",
    ahead: "activity",
    behind: "steady",
    deviated: "down",
    no_signal: "neutral",
  };

const statusLabel: Record<MiddayStatusLabel, string> = {
  on_track: "auf Kurs",
  ahead: "voraus",
  behind: "hinten",
  deviated: "abgewichen",
  no_signal: "kein Signal",
};

export function MiddayCheckDrillBody({
  payload,
}: {
  payload: MiddayCheckPayload;
}) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const cc = payload.course_correction;
  const stressHourly = Array.isArray(payload.stress_hourly) ? payload.stress_hourly : null;
  const hasStress =
    stressHourly !== null && stressHourly.some((v) => v != null);
  return (
    <div className="flex flex-col gap-4">
      {payload.headline ? (
        <p className="text-base font-semibold text-[var(--color-text)]">
          {payload.headline}
        </p>
      ) : null}
      {payload.summary_short ? (
        <p className="text-sm text-[var(--color-text-strong)]">
          {payload.summary_short}
        </p>
      ) : null}

      <section className="flex flex-col gap-2 rounded-md bg-[var(--color-surface-soft)] p-3">
        <header className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Status
          </h3>
          <Pill tone={statusTone[payload.status.label]} size="sm">
            {statusLabel[payload.status.label]}
          </Pill>
        </header>
        <p className="text-[0.75rem] italic text-[var(--color-text-muted)]">
          {payload.status.reasoning}
        </p>
      </section>

      {payload.next_window ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Nächstes Fenster
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.next_window}
          </p>
        </section>
      ) : null}

      {cc ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Kurskorrektur
          </h3>
          <DrillSuggestionCard
            suggestion={{
              anchor: cc.anchor,
              tiny: cc.tiny,
              why: cc.why,
              reasoning: cc.reasoning,
            }}
          />
        </section>
      ) : null}

      {hasStress && stressHourly ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Stress heute
          </h3>
          <div className="rounded-md bg-[var(--color-surface-soft)] p-3">
            <StressHourly values={stressHourly} height={96} />
          </div>
        </section>
      ) : null}

      {payload.confidence ? (
        <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
          <Confidence value={payload.confidence.value} mode="pill" />
          {payload.confidence.reasoning ? (
            <p className="text-[0.6875rem] italic text-[var(--color-text-muted)]">
              {payload.confidence.reasoning}
            </p>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
