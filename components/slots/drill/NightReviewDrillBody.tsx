"use client";

import { Confidence } from "@/components/ui/confidence";
import { AbstainNote } from "@/components/slots/_AbstainNote";
import { safeArr } from "@/components/slots/_safe";
import { SleepStagesChart } from "@/components/charts/sleep-stages-chart";
import { DrillKpiRow } from "./DrillKpiRow";
import { DrillSuggestionCard } from "./DrillSuggestionCard";
import type { NightReviewPayload } from "@/runner/v4/slots/night-review/types.ts";

export function NightReviewDrillBody({
  payload,
}: {
  payload: NightReviewPayload;
}) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const kpis = safeArr(payload.kpis);
  const suggestions = safeArr(payload.suggestions_today);
  const stages = safeArr(payload.stages_timeline);
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
      {payload.analysis_today ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Heute
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.analysis_today}
          </p>
        </section>
      ) : null}
      {payload.analysis_context ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Kontext
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.analysis_context}
          </p>
        </section>
      ) : null}

      {stages.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Hypnogramm
          </h3>
          <div className="rounded-md bg-[var(--color-surface-soft)] p-3">
            <SleepStagesChart segments={stages} height={180} />
          </div>
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

      {suggestions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Vorschläge
          </h3>
          <div className="flex flex-col gap-2">
            {suggestions.map((s, i) => (
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
