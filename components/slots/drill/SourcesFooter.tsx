"use client";

import type { SlotEntry } from "@/runner/v4/types.ts";

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SourcesFooter({
  entry,
}: {
  entry: SlotEntry<unknown> | null | undefined;
}) {
  if (!entry?.inputs_used) return null;
  const { facts_hash, data_window, prior_slot_refs } = entry.inputs_used;
  const cb = entry.computed_by;
  return (
    <details className="mt-3 rounded-md bg-[var(--color-surface-soft)] px-3 py-2 text-[0.6875rem] text-[var(--color-text-muted)]">
      <summary className="cursor-pointer select-none font-medium text-[var(--color-text)]">
        Quellen
      </summary>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt>facts_hash</dt>
        <dd className="font-mono">{facts_hash}</dd>
        <dt>Datenfenster</dt>
        <dd>
          {fmtIso(data_window.from)} → {fmtIso(data_window.to)}
        </dd>
        {cb ? (
          <>
            <dt>Modell</dt>
            <dd className="font-mono">{cb.model}</dd>
            <dt>Prompt</dt>
            <dd className="font-mono">{cb.prompt_version}</dd>
          </>
        ) : null}
        {prior_slot_refs.length > 0 ? (
          <>
            <dt>Vorslots</dt>
            <dd>
              <ul className="space-y-0.5">
                {prior_slot_refs.map((r, i) => (
                  <li key={`${r.slot_id}-${i}`}>
                    <span className="font-mono">{r.slot_id}</span> ·{" "}
                    {fmtIso(r.computed_at)}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}
