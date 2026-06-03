"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Shared prose body for slot cells. Renders headline / summary / long
 * narrative + optional KPI strip + optional suggestion list + a confidence
 * meter.
 *
 * Per-slot wrappers (NightReviewBody, etc.) compose this and pass the
 * fields that match their payload shape. Visual hierarchy lives here so every
 * slot reads the same: a clear headline, calm supporting prose, KPIs with a
 * band-colored stripe, and suggestions as tappable, domain-tinted rows.
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

export type ProseDomain =
  | "sleep"
  | "heart"
  | "activity"
  | "stress"
  | "body"
  | "nutrition";

export interface ProseBodyProps {
  headline: string | null;
  summary_short: string | null;
  summary_long?: string | null;
  /** Extra prose paragraphs to render under the summary. */
  paragraphs?: Array<{ label?: string; text: string | null }>;
  kpis?: ProseKpi[];
  suggestions?: ProseSuggestion[];
  /** 0..1 model confidence; renders a small meter when present. */
  confidence?: number | null;
  /** Domain accent for the suggestion stripe + confidence meter. */
  domain?: ProseDomain;
  /** Tail node: per-slot extras (plan adherence, wind-down hint, etc.). */
  extras?: ReactNode;
}

const BAND_LABEL: Record<ProseKpi["band"], string> = {
  above_usual: "über üblich",
  steady: "stabil",
  below_usual: "unter üblich",
};

const BAND_BAR: Record<ProseKpi["band"], string> = {
  above_usual: "bg-[var(--color-band-up)]",
  steady: "bg-[var(--color-band-steady)]",
  below_usual: "bg-[var(--color-band-down)]",
};

const DOMAIN_VAR: Record<ProseDomain, string> = {
  sleep: "var(--color-sleep)",
  heart: "var(--color-heart)",
  activity: "var(--color-activity)",
  stress: "var(--color-stress)",
  body: "var(--color-temp)",
  nutrition: "var(--color-nutrition)",
};

export function ProseBody({
  headline,
  summary_short,
  summary_long,
  paragraphs,
  kpis,
  suggestions,
  confidence,
  domain,
  extras,
}: ProseBodyProps) {
  const accent = domain ? DOMAIN_VAR[domain] : "var(--color-border-strong)";
  return (
    <div className="flex flex-col gap-3.5">
      {headline ? (
        <p className="text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] text-[var(--color-text)]">
          {headline}
        </p>
      ) : null}
      {summary_short ? (
        <p className="text-[0.875rem] leading-relaxed text-[var(--color-text-strong)]">
          {summary_short}
        </p>
      ) : null}
      {summary_long ? (
        <p className="text-[0.8125rem] leading-relaxed text-[var(--color-text-muted)]">
          {summary_long}
        </p>
      ) : null}
      {paragraphs?.map((p, i) =>
        p.text ? (
          <p key={i} className="text-[0.8125rem] leading-relaxed text-[var(--color-text-muted)]">
            {p.label ? (
              <span className="mr-1.5 font-medium text-[var(--color-text-subtle)]">
                {p.label}
              </span>
            ) : null}
            {p.text}
          </p>
        ) : null,
      )}

      {kpis && kpis.length > 0 ? (
        <ul className="flex flex-col gap-px overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)]/40">
          {kpis.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 py-1.5 pr-2.5 text-[0.8125rem]"
            >
              <span className="flex min-w-0 items-center gap-2.5 text-[var(--color-text-muted)]">
                <span className={cn("h-4 w-[3px] shrink-0 rounded-full", BAND_BAR[k.band])} />
                <span className="truncate">{k.label_de}</span>
              </span>
              <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="num font-semibold text-[var(--color-text)]">
                  {Math.round(k.value)}
                </span>
                <span className="text-[0.6875rem] text-[var(--color-text-subtle)]">
                  {BAND_LABEL[k.band]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {suggestions && suggestions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {suggestions.map((s, i) => (
            <li
              key={i}
              className="group flex gap-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] p-2.5 transition-colors duration-150 hover:bg-[var(--color-surface-2)]"
            >
              <span
                className="mt-0.5 w-[2px] shrink-0 rounded-full opacity-70 transition-opacity duration-150 group-hover:opacity-100"
                style={{ backgroundColor: accent }}
              />
              <div className="min-w-0 text-[0.8125rem]">
                <div className="font-medium text-[var(--color-text)]">{s.tiny}</div>
                <div className="mt-0.5 text-[var(--color-text-muted)]">
                  {s.anchor}
                  {s.why ? ` · ${s.why}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {extras}

      {confidence != null && Number.isFinite(confidence) ? (
        <div className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-[var(--color-text-subtle)]">
          <span className="eyebrow !tracking-[0.12em]">Sicherheit</span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`,
                backgroundColor: accent,
              }}
            />
          </span>
          <span className="num">{Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%</span>
        </div>
      ) : null}
    </div>
  );
}
