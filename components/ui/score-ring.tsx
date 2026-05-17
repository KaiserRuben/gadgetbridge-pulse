"use client";

import { motion, useMotionValue, useTransform, useSpring } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";

// Inner number scales with ring size — at compact 96px the global text-display
// (clamp 56–88px) overflows. Use a sliding cap based on radius.
function fontSizeFor(size: number): string {
  if (size <= 100) return "1.25rem";   // 20px
  if (size <= 140) return "1.75rem";   // 28px
  if (size <= 180) return "2.5rem";    // 40px
  return "4.25rem";                     // 68px
}

type Band = "steady" | "above_usual" | "below_usual" | null;

const bandStroke: Record<NonNullable<Band> | "none", string> = {
  steady:       "var(--color-band-steady)",
  above_usual:  "var(--color-band-up)",
  below_usual:  "var(--color-band-down)",
  none:         "var(--color-band-low)",
};

export function ScoreRing({
  score,
  band,
  size = 220,
  stroke = 10,
  className,
}: {
  score: number;
  band?: Band;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const target = Math.max(0, Math.min(100, score));
  const m = useMotionValue(0);
  const dash = useTransform(m, (v) => circ * (1 - v / 100));
  const text = useTransform(m, (v) => Math.round(v).toString());
  const eased = useSpring(m, { stiffness: 80, damping: 24, mass: 0.6 });
  const dashEased = useTransform(eased, (v) => circ * (1 - v / 100));
  void dash; // export for ssr fallback

  useEffect(() => {
    const id = requestAnimationFrame(() => m.set(target));
    return () => cancelAnimationFrame(id);
  }, [m, target]);

  const color = bandStroke[band ?? "none"];

  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor="var(--color-sleep-2)" stopOpacity="0.85" />
          </linearGradient>
          <filter id="ring-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-border)"
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circ}
          style={{ strokeDashoffset: dashEased }}
        />
      </svg>
      <div className="grid place-items-center text-center">
        <motion.span
          className="num leading-none font-semibold tracking-tight tabular-nums"
          style={{ fontSize: fontSizeFor(size) }}
        >
          {text}
        </motion.span>
        <span className="text-caption mt-1">/100</span>
      </div>
    </div>
  );
}
