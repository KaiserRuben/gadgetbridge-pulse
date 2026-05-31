"use client";

export interface DrillSuggestion {
  anchor: string;
  tiny: string;
  why: string;
  reasoning: string;
  horizon?: string;
}

export function DrillSuggestionCard({
  suggestion,
}: {
  suggestion: DrillSuggestion;
}) {
  const { anchor, tiny, why, reasoning, horizon } = suggestion;
  return (
    <article className="rounded-md bg-[var(--color-surface-soft)] p-3">
      <header className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-[var(--color-text)]">
          {tiny}
        </h4>
        <div className="flex shrink-0 items-center gap-1.5">
          {horizon ? (
            <span className="rounded-[var(--radius-pill)] bg-[var(--color-surface)] px-2 py-0.5 text-[0.6875rem] text-[var(--color-text-muted)] ring-1 ring-inset ring-[var(--color-border)]">
              {horizon}
            </span>
          ) : null}
          <span className="rounded-[var(--radius-pill)] bg-[var(--color-surface)] px-2 py-0.5 text-[0.6875rem] font-mono text-[var(--color-text-muted)] ring-1 ring-inset ring-[var(--color-border)]">
            {anchor}
          </span>
        </div>
      </header>
      <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">{why}</p>
      {reasoning ? (
        <details className="mt-2 text-[0.75rem] text-[var(--color-text-muted)]">
          <summary className="cursor-pointer select-none text-[var(--color-text)]">
            Warum?
          </summary>
          <p className="mt-1 italic">{reasoning}</p>
        </details>
      ) : null}
    </article>
  );
}
