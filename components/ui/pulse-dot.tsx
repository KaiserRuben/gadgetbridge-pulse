import { cn } from "@/lib/cn";

export function PulseDot({
  tone = "sleep",
  className,
}: {
  tone?: "sleep" | "heart" | "activity" | "stress" | "body" | "neutral";
  className?: string;
}) {
  const color =
    tone === "heart"    ? "var(--color-heart)"
    : tone === "activity" ? "var(--color-activity)"
    : tone === "stress"  ? "var(--color-stress)"
    : tone === "body"    ? "var(--color-temp)"
    : tone === "neutral" ? "var(--color-text-muted)"
    : "var(--color-sleep)";
  return (
    <span
      className={cn("relative inline-block size-2 rounded-full", className)}
      style={{ background: color }}
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: color, animation: "ringPulse 2.4s var(--ease-out) infinite", opacity: 0.5 }}
      />
    </span>
  );
}
