"use client";

import { Pill } from "@/components/ui/pill";
import { Confidence } from "@/components/ui/confidence";
import { AbstainNote } from "@/components/slots/_AbstainNote";
import { DrillSuggestionCard } from "./DrillSuggestionCard";
import type {
  MorningBriefingPayload,
  PlanAdherenceStatus,
} from "@/runner/v4/slots/morning-briefing/types.ts";

const planTone: Record<
  PlanAdherenceStatus,
  Parameters<typeof Pill>[0]["tone"]
> = {
  proceed: "up",
  modify: "steady",
  skip: "down",
  no_plan: "neutral",
};

const planLabel: Record<PlanAdherenceStatus, string> = {
  proceed: "Plan beibehalten",
  modify: "Plan anpassen",
  skip: "Plan auslassen",
  no_plan: "kein Plan",
};

export function MorningBriefingDrillBody({
  payload,
}: {
  payload: MorningBriefingPayload;
}) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const pa = payload.plan_adherence;
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
      {payload.focus_today ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Fokus heute
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.focus_today}
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 rounded-md bg-[var(--color-surface-soft)] p-3">
        <header className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Plan
          </h3>
          <Pill tone={planTone[pa.status]} size="sm">
            {planLabel[pa.status]}
          </Pill>
        </header>
        {pa.recommendation ? (
          <p className="text-sm text-[var(--color-text)]">{pa.recommendation}</p>
        ) : null}
        <p className="text-[0.75rem] italic text-[var(--color-text-muted)]">
          {pa.reasoning}
        </p>
      </section>

      {payload.suggestions_today.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Vorschläge
          </h3>
          <div className="flex flex-col gap-2">
            {payload.suggestions_today.map((s, i) => (
              <DrillSuggestionCard
                key={`${s.anchor}-${i}`}
                suggestion={{
                  anchor: s.anchor,
                  tiny: s.tiny,
                  why: s.why,
                  reasoning: s.reasoning,
                  horizon: s.horizon,
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
