"use client";

import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Confidence } from "@/components/ui/confidence";
import { AbstainNote } from "@/components/slots/_AbstainNote";
import { safeArr } from "@/components/slots/_safe";
import type {
  AnomalyExplainPayload,
  DriverWeight,
} from "@/runner/v4/slots/anomaly-explain/types.ts";

const weightTone: Record<DriverWeight, Parameters<typeof Pill>[0]["tone"]> = {
  high: "s1",
  medium: "steady",
  low: "neutral",
};

const weightLabel: Record<DriverWeight, string> = {
  high: "hoch",
  medium: "mittel",
  low: "niedrig",
};

export function AnomalyExplainDrillBody({
  payload,
  observation_id,
}: {
  payload: AnomalyExplainPayload;
  observation_id?: string;
}) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const drivers = safeArr(payload.likely_drivers);
  return (
    <div className="flex flex-col gap-4">
      {observation_id ? (
        <Eyebrow>
          Beobachtung <span className="font-mono">{observation_id}</span>
        </Eyebrow>
      ) : null}
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

      {payload.what_happened ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Was passiert ist
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.what_happened}
          </p>
        </section>
      ) : null}

      {drivers.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Wahrscheinliche Ursachen
          </h3>
          <ol className="flex flex-col gap-2">
            {drivers.map((d, i) => (
              <li
                key={`${d.driver}-${i}`}
                className="rounded-md bg-[var(--color-surface-soft)] p-3"
              >
                <header className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[var(--color-text)]">
                    {i + 1}. {d.driver}
                  </span>
                  <Pill tone={weightTone[d.weight]} size="sm">
                    {weightLabel[d.weight]}
                  </Pill>
                </header>
                <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
                  {d.evidence}
                </p>
                <details className="mt-2 text-[0.75rem] text-[var(--color-text-muted)]">
                  <summary className="cursor-pointer select-none text-[var(--color-text)]">
                    Warum?
                  </summary>
                  <p className="mt-1 italic">{d.reasoning}</p>
                </details>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {payload.what_to_watch ? (
        <section className="rounded-md bg-[var(--color-surface-soft)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            Worauf achten
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text)]">
            {payload.what_to_watch}
          </p>
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
