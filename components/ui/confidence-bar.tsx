import { cn } from "@/lib/cn";
import { confidenceTier } from "@/lib/confidence";

/**
 * @deprecated Use `<Confidence mode="bar" />` from `components/ui/confidence`
 * instead. This export stays for back-compat with existing call sites; U2/U3
 * sweeps will replace them.
 */
export function ConfidenceBar({
  value,
  className,
}: {
  /** 0..1 */
  value: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tier = confidenceTier(value);
  const tone =
    tier === "up" ? "var(--color-band-up)"
    : tier === "steady" ? "var(--color-band-steady)"
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
