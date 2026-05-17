import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Eyebrow } from "./eyebrow";

export function Stat({
  label,
  value,
  unit,
  hint,
  delta,
  align = "left",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  delta?: { value: number; suffix?: string };
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const alignCls = align === "right" ? "items-end text-right" : align === "center" ? "items-center text-center" : "items-start";
  return (
    <div className={cn("flex flex-col gap-1", alignCls, className)}>
      <Eyebrow>{label}</Eyebrow>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[1.75rem] font-semibold tracking-[-0.02em] leading-none">{value}</span>
        {unit && <span className="text-subtle text-[0.75rem] num-mono">{unit}</span>}
      </div>
      {(hint || delta) && (
        <div className="flex items-center gap-2 text-caption">
          {delta && <DeltaChip delta={delta.value} suffix={delta.suffix} />}
          {hint && <span className="text-subtle">{hint}</span>}
        </div>
      )}
    </div>
  );
}

function DeltaChip({ delta, suffix }: { delta: number; suffix?: string }) {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const tone =
    delta > 0
      ? "text-[var(--color-band-up)]"
      : delta < 0
      ? "text-[var(--color-band-down)]"
      : "text-subtle";
  return (
    <span className={cn("num-mono", tone)}>
      {sign}
      {Math.abs(delta).toLocaleString()}
      {suffix}
    </span>
  );
}
