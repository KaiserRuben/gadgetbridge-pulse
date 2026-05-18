import { Sparkles } from "lucide-react";

import { cn } from "@/lib/cn";
import { PulseDot } from "@/components/ui/pulse-dot";

type Variant = "default" | "reprocessing";
type Placement = "inline" | "float";
type Tone = "auto" | "sleep" | "heart" | "activity" | "stress" | "nutrition" | "neutral";

const DEFAULT_LABEL: Record<Variant, string> = {
  default: "Wird heute Nacht berechnet",
  reprocessing: "Wird neu berechnet",
};

const TONE_SURFACE: Record<Exclude<Tone, "auto">, string> = {
  sleep:     "bg-[hsl(252_40%_18%)] text-[var(--color-sleep)] ring-[hsl(252_40%_30%)]",
  heart:     "bg-[hsl(348_40%_18%)] text-[var(--color-heart)] ring-[hsl(348_40%_30%)]",
  activity:  "bg-[hsl(150_40%_18%)] text-[var(--color-activity)] ring-[hsl(150_40%_30%)]",
  stress:    "bg-[hsl(28_40%_18%)]  text-[var(--color-stress)]   ring-[hsl(28_40%_30%)]",
  nutrition: "bg-[hsl(346_36%_18%)] text-[var(--color-nutrition)] ring-[hsl(346_36%_30%)]",
  neutral:   "bg-[hsl(220_18%_16%)] text-[var(--color-text-muted)] ring-[var(--color-border)]",
};

const TONE_DOT: Record<Exclude<Tone, "auto">, "sleep" | "heart" | "activity" | "stress" | "neutral" | "body"> = {
  sleep: "sleep",
  heart: "heart",
  activity: "activity",
  stress: "stress",
  nutrition: "heart",
  neutral: "neutral",
};

/**
 * Badge for the "today is still in progress" UI state — distinct from the
 * abstain state (where the runner DID try and chose not to speak). The runner
 * deliberately holds back the LLM verdict until the day completes; this badge
 * tells the user that.
 *
 * Variants:
 *  - `default` — neutral surface, "Wird heute Nacht berechnet". Used at the
 *    top of pages waiting for the finalize loop.
 *  - `reprocessing` — sleep-tinted surface, "Wird neu berechnet". Used by
 *    `<DerivedCell>` to overlay a "we're baking a new version" hint on top of
 *    a cached payload. The literal sparkle glyph (was U+2728 `✨`) is now a
 *    Lucide `<Sparkles>` so its weight matches the rest of the icon system.
 *
 * Placement:
 *  - `inline` — regular inline-block, sits in the flow. Default.
 *  - `float` — positions absolutely; the caller decides anchor + offsets.
 *    Used in DerivedCell to pin top-right of a cached payload.
 */
export function InProgressBadge({
  className,
  label,
  variant = "default",
  placement = "inline",
  tone = "auto",
}: {
  className?: string;
  label?: string;
  variant?: Variant;
  placement?: Placement;
  tone?: Tone;
}) {
  const resolvedLabel = label ?? DEFAULT_LABEL[variant];
  const resolvedTone: Exclude<Tone, "auto"> =
    tone === "auto"
      ? variant === "reprocessing" ? "sleep" : "neutral"
      : tone;
  const surfaceCls = TONE_SURFACE[resolvedTone];
  const dotTone = TONE_DOT[resolvedTone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-2 py-1 text-[0.6875rem] font-medium ring-1 ring-inset",
        surfaceCls,
        placement === "float" && "absolute",
        className,
      )}
    >
      {variant === "reprocessing" ? (
        <Sparkles size={12} strokeWidth={1.75} />
      ) : (
        <PulseDot tone={dotTone} />
      )}
      {resolvedLabel}
    </span>
  );
}
