"use client";

import type { ReactNode } from "react";

/**
 * Shared prose body for slot cells. Renders headline / summary / long
 * narrative + optional KPI strip + optional suggestion list.
 *
 * Per-slot wrappers (NightReviewBody, etc.) compose this and pass the
 * fields that match their payload shape.
 */

export interface ProseSuggestion {
  anchor: string;
  tiny: string;
  why: string;
}

export interface ProseKpi {
  id: string;
  label_de: string;
  value: number;
  band: "above_usual" | "steady" | "below_usual";
}

export interface ProseBodyProps {
  headline: string | null;
  summary_short: string | null;
  summary_long?: string | null;
  /** Extra prose paragraphs to render under the summary. */
  paragraphs?: Array<{ label?: string; text: string | null }>;
  kpis?: ProseKpi[];
  suggestions?: ProseSuggestion[];
  /** Tail node: per-slot extras (plan adherence, wind-down hint, etc.). */
  extras?: ReactNode;
}

const BAND_LABEL: Record<ProseKpi["band"], string> = {
  above_usual: "über üblich",
  steady: "stabil",
  below_usual: "unter üblich",
};

const BAND_DOT: Record<ProseKpi["band"], string> = {
  above_usual: "bg-[var(--color-band-up)]",
  steady: "bg-[var(--color-band-steady)]",
  below_usual: "bg-[var(--color-band-down)]",
};

export function ProseBody({
  headline,
  summary_short,
  summary_long,
  paragraphs,
  kpis,
  suggestions,
  extras,
}: ProseBodyProps) {
  return (
    <div className="flex flex-col gap-3">
      {headline ? (
        <p className="text-sm font-semibold text-[var(--color-text)]">{headline}</p>
      ) : null}
      {summary_short ? (
        <p className="text-sm text-[var(--color-text-strong)]">{summary_short}</p>
      ) : null}
      {summary_long ? (
        <p className="text-sm text-[var(--color-text-muted)]">{summary_long}</p>
      ) : null}
      {paragraphs?.map((p, i) =>
        p.text ? (
          <div key={i} className="text-sm text-[var(--color-text-muted)]">
            {p.label ? (
              <span className="mr-1 font-medium text-[var(--color-text)]">{p.label}:</span>
            ) : null}
            {p.text}
          </div>
        ) : null,
      )}

      {kpis && kpis.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {kpis.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="flex items-center gap-2 text-[var(--color-text-muted)]">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${BAND_DOT[k.band]}`} />
                {k.label_de}
              </span>
              <span className="num font-medium">
                {Math.round(k.value)}
                <span className="ml-1 text-[0.6875rem] text-[var(--color-text-muted)]">
                  · {BAND_LABEL[k.band]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {suggestions && suggestions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {suggestions.map((s, i) => (
            <li key={i} className="rounded-md bg-[var(--color-surface-soft)] p-2 text-xs">
              <div className="font-medium text-[var(--color-text)]">{s.tiny}</div>
              <div className="text-[var(--color-text-muted)]">
                {s.anchor}
                {s.why ? ` · ${s.why}` : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {extras}
    </div>
  );
}
