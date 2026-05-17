import { cn } from "@/lib/cn";
import { PulseDot } from "@/components/ui/pulse-dot";

/**
 * Badge for the "today is still in progress" UI state — distinct from the
 * abstain state (where the runner DID try and chose not to speak). The runner
 * deliberately holds back the LLM verdict until the day completes; this badge
 * tells the user that.
 */
export function InProgressBadge({
  className,
  label = "Wird heute Nacht berechnet",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-[hsl(220_18%_16%)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--color-text-muted)] ring-1 ring-inset ring-[var(--color-border)]",
        className,
      )}
    >
      <PulseDot tone="neutral" />
      {label}
    </span>
  );
}
