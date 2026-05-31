"use client";

import { Pill } from "@/components/ui/pill";
import { Confidence } from "@/components/ui/confidence";
import { AbstainNote } from "@/components/slots/_AbstainNote";
import { DrillKpiRow } from "./DrillKpiRow";
import { DrillSuggestionCard } from "./DrillSuggestionCard";
import type {
  EveningReviewPayload,
  LoadAssessment,
} from "@/runner/v4/slots/evening-review/types.ts";

const loadTone: Record<LoadAssessment, Parameters<typeof Pill>[0]["tone"]> = {
  light: "up",
  moderate: "activity",
  hard: "steady",
  max: "s1",
  no_workout: "neutral",
};

const loadLabel: Record<LoadAssessment, string> = {
  light: "leicht",
  moderate: "moderat",
  hard: "hart",
  max: "Maximum",
  no_workout: "kein Training",
};

export function EveningReviewDrillBody({
  payload,
}: {
  payload: EveningReviewPayload;
}) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const wi = payload.workout_impact;
  const wd = payload.wind_down_suggestion;
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
      {payload.summary_long ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          {payload.summary_long}
        </p>
      ) : null}
      {payload.day_so_far ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Tag bisher
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.day_so_far}
          </p>
        </section>
      ) : null}

      {wi ? (
        <section className="flex flex-col gap-2 rounded-md bg-[var(--color-surface-soft)] p-3">
          <header className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Trainings-Einfluss
            </h3>
            <Pill tone={loadTone[wi.load_assessment]} size="sm">
              {loadLabel[wi.load_assessment]}
            </Pill>
          </header>
          <p className="text-sm text-[var(--color-text)]">{wi.recovery_hint}</p>
          <p className="text-[0.75rem] italic text-[var(--color-text-muted)]">
            {wi.reasoning}
          </p>
        </section>
      ) : null}

      {wd ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Runterfahren
          </h3>
          <DrillSuggestionCard
            suggestion={{
              anchor: wd.anchor,
              tiny: wd.tiny,
              why: wd.why,
              reasoning: wd.reasoning,
            }}
          />
        </section>
      ) : null}

      {payload.kpis.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Kennzahlen
          </h3>
          <div className="flex flex-col gap-1.5">
            {payload.kpis.map((k) => (
              <DrillKpiRow
                key={k.id}
                kpi={{
                  label: k.label_de,
                  value: k.value,
                  band: k.band,
                  reasoning: k.reasoning,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
        <Confidence value={payload.confidence.value} mode="pill" />
        <p className="text-[0.6875rem] italic text-[var(--color-text-muted)]">
          {payload.confidence.reasoning}
        </p>
      </footer>
    </div>
  );
}
