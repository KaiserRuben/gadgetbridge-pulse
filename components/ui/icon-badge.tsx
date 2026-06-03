import { Glyph, type GlyphName } from "./glyph";
import { cn } from "@/lib/cn";

/**
 * Standard rounded icon chip used across feature pages (activities, workouts,
 * labs, settings, nutrition, profile all hand-rolled this). Two fills:
 *   - `soft` (default): surface background + accent-tinted icon.
 *   - `solid`: a subtle domain-accent gradient + accent icon (hero rows).
 * Use this instead of `grid place-items-center size-N rounded-… bg-…`.
 */
export type IconBadgeTone =
  | "neutral"
  | "sleep"
  | "heart"
  | "activity"
  | "stress"
  | "nutrition"
  | "body";

const ACCENT: Record<IconBadgeTone, [string, string]> = {
  neutral: ["var(--color-text-muted)", "var(--color-text-muted)"],
  sleep: ["var(--color-sleep)", "var(--color-sleep-2)"],
  heart: ["var(--color-heart)", "var(--color-heart-2)"],
  activity: ["var(--color-activity)", "var(--color-activity-2)"],
  stress: ["var(--color-stress)", "var(--color-stress-2)"],
  nutrition: ["var(--color-nutrition)", "var(--color-nutrition-2)"],
  body: ["var(--color-temp)", "var(--color-temp)"],
};

const SIZES = {
  sm: { box: "size-8 rounded-[var(--radius-sm)]", glyph: 14 },
  md: { box: "size-10 rounded-[var(--radius-chip)]", glyph: 18 },
  lg: { box: "size-12 rounded-[var(--radius-card)]", glyph: 20 },
} as const;

export function IconBadge({
  icon,
  tone = "neutral",
  size = "md",
  variant = "soft",
  className,
}: {
  icon: GlyphName;
  tone?: IconBadgeTone;
  size?: keyof typeof SIZES;
  variant?: "soft" | "solid";
  className?: string;
}) {
  const s = SIZES[size];
  const [a, a2] = ACCENT[tone];
  const style =
    variant === "solid" && tone !== "neutral"
      ? {
          backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${a} 28%, transparent), color-mix(in srgb, ${a2} 16%, transparent))`,
          borderColor: `color-mix(in srgb, ${a} 40%, transparent)`,
          color: a,
        }
      : {
          backgroundColor: "var(--color-surface-2)",
          borderColor: "var(--color-border)",
          color: tone === "neutral" ? "var(--color-text-muted)" : a,
        };
  return (
    <span className={cn("grid shrink-0 place-items-center border", s.box, className)} style={style}>
      <Glyph name={icon} size={s.glyph} />
    </span>
  );
}
