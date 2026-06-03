"use client";

import { Confidence } from "@/components/ui/confidence";
import { AbstainNote } from "@/components/slots/_AbstainNote";
import { safeArr } from "@/components/slots/_safe";
import { DrillKpiRow } from "./DrillKpiRow";
import type { WeekSynthesisPayload } from "@/runner/v4/slots/week-synthesis/types.ts";

/**
 * Full weekly breakdown — the drill twin of WeekSynthesisBody. Surfaces every
 * generated field including the per-anchor, per-KPI and confidence reasoning
 * that the compact ProseBody drops. Mirrors DaySynthesisDrillBody.
 */
export function WeekSynthesisDrillBody({
  payload,
}: {
  payload: WeekSynthesisPayload;
}) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const anchors = safeArr(payload.top_anchors);
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
      {payload.week_narrative ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Wochenverlauf
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.week_narrative}
          </p>
        </section>
      ) : null}
      {payload.next_week_focus ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Fokus nächste Woche
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.next_week_focus}
          </p>
        </section>
      ) : null}

      {anchors.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Top-Anker
          </h3>
          <ul className="flex flex-col gap-2">
            {anchors.map((a, i) => (
              <li
                key={`${a.signal}-${i}`}
                className="rounded-md bg-[var(--color-surface-soft)] p-3"
              >
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  {a.signal}
                </div>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {a.takeaway}
                </p>
                {a.reasoning ? (
                  <details className="mt-2 text-[0.75rem] text-[var(--color-text-muted)]">
                    <summary className="cursor-pointer select-none text-[var(--color-text)]">
                      Warum?
                    </summary>
                    <p className="mt-1 italic">{a.reasoning}</p>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
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
