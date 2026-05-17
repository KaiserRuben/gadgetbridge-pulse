import { cn } from "@/lib/cn";
import type { PropsWithChildren } from "react";

type Tone = "neutral" | "sleep" | "heart" | "activity" | "body" | "stress" | "nutrition" | "up" | "down" | "steady" | "low" | "s1" | "s2" | "s3";

const toneCls: Record<Tone, string> = {
  neutral:  "bg-[hsl(240_4%_15%)] text-[var(--color-text-muted)] ring-[var(--color-border)]",
  sleep:    "bg-[hsl(252_64%_18%)] text-[var(--color-sleep)] ring-[hsl(252_60%_28%)]",
  heart:    "bg-[hsl(348_60%_18%)] text-[var(--color-heart)] ring-[hsl(348_56%_28%)]",
  activity: "bg-[hsl(150_50%_15%)] text-[var(--color-activity)] ring-[hsl(150_46%_24%)]",
  body:     "bg-[hsl(20_60%_16%)]  text-[var(--color-temp)]    ring-[hsl(20_56%_26%)]",
  stress:   "bg-[hsl(28_60%_16%)]  text-[var(--color-stress)]  ring-[hsl(28_56%_26%)]",
  nutrition:"bg-[hsl(346_40%_18%)] text-[var(--color-nutrition)] ring-[hsl(346_36%_28%)]",
  up:       "bg-[hsl(195_50%_18%)] text-[var(--color-band-up)] ring-[hsl(195_46%_28%)]",
  down:     "bg-[hsl(38_50%_18%)]  text-[var(--color-band-down)] ring-[hsl(38_46%_28%)]",
  steady:   "bg-[hsl(220_18%_18%)] text-[var(--color-band-steady)] ring-[hsl(220_18%_28%)]",
  low:      "bg-[hsl(240_5%_14%)]  text-[var(--color-band-low)]  ring-[var(--color-border)]",
  s1:       "bg-[hsl(4_60%_18%)]   text-[var(--color-tier-s1)]   ring-[hsl(4_56%_28%)]",
  s2:       "bg-[hsl(28_60%_18%)]  text-[var(--color-tier-s2)]   ring-[hsl(28_56%_28%)]",
  s3:       "bg-[hsl(220_18%_16%)] text-[var(--color-tier-s3)]   ring-[hsl(220_18%_24%)]",
};

export function Pill({
  tone = "neutral",
  size = "md",
  className,
  children,
}: PropsWithChildren<{ tone?: Tone; size?: "sm" | "md"; className?: string }>) {
  const sz =
    size === "sm"
      ? "h-5 px-1.5 text-[0.6875rem]"
      : "h-6 px-2 text-[0.75rem]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-pill)] font-medium tracking-[0.02em] ring-1 ring-inset",
        sz,
        toneCls[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
