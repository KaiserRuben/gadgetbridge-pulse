import { cn } from "@/lib/cn";

interface Props {
  sent24h: number;
  budget: number;
}

/**
 * Bar meter showing how many sends were used in the rolling 24h vs the
 * configured daily budget. Calm by design — no warning colours; budget is
 * a soft commitment to the user, not an alarm condition.
 */
export function BudgetMeter({ sent24h, budget }: Props) {
  const pct = budget > 0 ? Math.min(1, sent24h / budget) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/40 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-body-sm text-muted">Heute gesendet</span>
        <span className="text-body-sm tabular-nums">
          {sent24h} / {budget}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/20 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            sent24h >= budget ? "bg-muted" : "bg-foreground/80",
          )}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  );
}
