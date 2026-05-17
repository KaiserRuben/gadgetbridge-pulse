import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Size = "display" | "hero" | "title" | "body" | "caption";

const sizes: Record<Size, string> = {
  display: "text-display",
  hero:    "text-[clamp(2rem,5vw,3rem)] font-semibold tracking-[-0.03em] leading-none",
  title:   "text-[1.5rem] font-semibold tracking-[-0.02em] leading-tight",
  body:    "text-[1rem] font-semibold",
  caption: "text-[0.8125rem] font-medium",
};

export function Num({
  value,
  unit,
  size = "title",
  tone = "default",
  className,
  prefix,
}: {
  value: ReactNode;
  unit?: ReactNode;
  size?: Size;
  tone?: "default" | "muted" | "subtle";
  className?: string;
  prefix?: ReactNode;
}) {
  const toneCls =
    tone === "muted" ? "text-muted" : tone === "subtle" ? "text-subtle" : "";
  return (
    <span className={cn("num inline-flex items-baseline gap-1", sizes[size], toneCls, className)}>
      {prefix != null && <span className="text-subtle text-[0.55em] font-medium mr-0.5">{prefix}</span>}
      <span>{value}</span>
      {unit != null && (
        <span className="text-subtle text-[0.5em] font-medium tracking-normal num-mono">{unit}</span>
      )}
    </span>
  );
}
