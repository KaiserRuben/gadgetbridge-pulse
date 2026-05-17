import { cn } from "@/lib/cn";

export function ConfidenceBar({
  value,
  className,
}: {
  /** 0..1 */
  value: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tone =
    value >= 0.7 ? "var(--color-band-up)"
    : value >= 0.5 ? "var(--color-band-steady)"
    : "var(--color-band-down)";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-1 w-16 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: tone }}
        />
      </div>
      <span className="text-caption">{Math.round(pct)}%</span>
    </div>
  );
}
