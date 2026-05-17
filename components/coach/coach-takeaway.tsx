import { Glyph } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";

export function CoachTakeaway({
  anchor,
  tiny,
  horizon = "today",
  domain,
  fallback,
  className,
}: {
  anchor: string;
  tiny: string;
  horizon?: "today" | "tonight" | "tomorrow" | "this_week";
  domain?: "sleep" | "heart" | "activity" | "stress" | "body";
  fallback?: string;
  className?: string;
}) {
  const tone = (domain ?? "neutral") as Parameters<typeof Pill>[0]["tone"];
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 ${className ?? ""}`}
    >
      <span className="grid place-items-center size-8 shrink-0 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
        <Glyph name="Sparkles" size={14} className="text-[var(--color-sleep)]" />
      </span>
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5">
          <Pill tone={tone} size="sm">{anchor}</Pill>
          <Pill tone="neutral" size="sm">{horizonLabel(horizon)}</Pill>
        </div>
        <div className="text-[0.9375rem] leading-snug">
          {tiny}
        </div>
        {fallback && (
          <div className="text-caption">Fallback: {fallback}</div>
        )}
      </div>
    </div>
  );
}

function horizonLabel(h: "today" | "tonight" | "tomorrow" | "this_week"): string {
  return h === "today"     ? "Heute"
       : h === "tonight"   ? "Heute Abend"
       : h === "tomorrow"  ? "Morgen"
       : "Diese Woche";
}
