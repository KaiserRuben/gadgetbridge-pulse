/**
 * Rendered when a slot's payload reports `abstain: true` — the model ran
 * but chose not to commit a narrative (data too thin, conflicting signals,
 * etc). Distinct from SlotCell's "abstained" status, which represents the
 * scheduler skipping the run before any LLM call.
 */
export function AbstainNote({ reason }: { reason: string | null }) {
  return (
    <p className="text-xs text-[var(--color-text-muted)]">
      Ausgesetzt: {reason ?? "Daten zu dünn"}
    </p>
  );
}
