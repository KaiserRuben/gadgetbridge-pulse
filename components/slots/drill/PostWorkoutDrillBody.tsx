"use client";

import { Pill } from "@/components/ui/pill";
import { Confidence } from "@/components/ui/confidence";
import { AbstainNote } from "@/components/slots/_AbstainNote";
import { safeArr } from "@/components/slots/_safe";
import { DrillKpiRow } from "./DrillKpiRow";
import { DrillSuggestionCard } from "./DrillSuggestionCard";
import type {
  LoadLevel,
  PostWorkoutPayload,
} from "@/runner/v4/slots/post-workout/types.ts";

const loadTone: Record<LoadLevel, Parameters<typeof Pill>[0]["tone"]> = {
  light: "up",
  moderate: "activity",
  hard: "steady",
  max: "s1",
};

const loadLabel: Record<LoadLevel, string> = {
  light: "leicht",
  moderate: "moderat",
  hard: "hart",
  max: "Maximum",
};

export function PostWorkoutDrillBody({
  payload,
}: {
  payload: PostWorkoutPayload;
}) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const la = payload.load_assessment;
  const rw = payload.recovery_window;
  const kpis = safeArr(payload.kpis);
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

      {la ? (
        <section className="flex flex-col gap-2 rounded-md bg-[var(--color-surface-soft)] p-3">
          <header className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Belastung
            </h3>
            <Pill tone={loadTone[la.level]} size="sm">
              {loadLabel[la.level]}
            </Pill>
          </header>
          <p className="text-sm text-[var(--color-text)]">{la.vs_recent}</p>
          <p className="text-[0.75rem] italic text-[var(--color-text-muted)]">
            {la.reasoning}
          </p>
        </section>
      ) : null}

      {rw ? (
        <section className="flex flex-col gap-2 rounded-md bg-[var(--color-surface-soft)] p-3">
          <header className="flex items-baseline gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Erholungsfenster
            </h3>
            {rw.hours_estimated != null ? (
              <span className="num text-sm font-medium text-[var(--color-text)]">
                ~{Math.round(rw.hours_estimated)} h
              </span>
            ) : null}
          </header>
          <p className="text-sm text-[var(--color-text)]">{rw.guidance}</p>
          <p className="text-[0.75rem] italic text-[var(--color-text-muted)]">
            {rw.reasoning}
          </p>
        </section>
      ) : null}

      {payload.fueling_hint ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Energiezufuhr
          </h3>
          <DrillSuggestionCard
            suggestion={{
              anchor: payload.fueling_hint.anchor,
              tiny: payload.fueling_hint.tiny,
              why: payload.fueling_hint.why,
              reasoning: payload.fueling_hint.reasoning,
            }}
          />
        </section>
      ) : null}

      {payload.next_session_hint ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Nächste Einheit
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.next_session_hint}
          </p>
        </section>
      ) : null}

      {kpis.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Kennzahlen
          </h3>
          <div className="flex flex-col gap-1.5">
            {kpis.map((k) => (
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
