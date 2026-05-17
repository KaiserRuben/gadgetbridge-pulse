"use client";

/**
 * Composable kcal-and-macros ring. Outer track is kcal-to-target; the
 * three inner arc segments represent the protein/carb/fat split of the
 * day so far. Designed to read at three sizes:
 *   - sm  (96px)  — home tile, sidebar widgets
 *   - md  (160px) — page header
 *   - lg  (220px) — trends + targets pages
 *
 * Animation borrowed from ScoreRing (lerped strokeDashoffset). Kept
 * dependency-free so it works on the Pi without recharts.
 */

import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useMemo } from "react";
import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg";

const SIZES: Record<
  Size,
  {
    dim: number;
    outerStroke: number;
    macroStroke: number;
    macroInset: number;
    valueFs: string;
    captionFs: string;
  }
> = {
  sm: { dim: 96,  outerStroke: 7,  macroStroke: 4, macroInset: 11, valueFs: "1.125rem", captionFs: "0.625rem" },
  md: { dim: 160, outerStroke: 10, macroStroke: 5, macroInset: 16, valueFs: "1.875rem", captionFs: "0.6875rem" },
  lg: { dim: 220, outerStroke: 12, macroStroke: 6, macroInset: 22, valueFs: "2.75rem", captionFs: "0.75rem" },
};

export type MacroSplit = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export function IntakeRing({
  kcal,
  kcalTarget,
  macros,
  size = "md",
  className,
}: {
  kcal: number;
  kcalTarget: number | null;
  macros: MacroSplit;
  size?: Size;
  className?: string;
}) {
  const cfg = SIZES[size];
  const dim = cfg.dim;
  const cx = dim / 2;
  const cy = dim / 2;

  // Outer track — kcal / kcalTarget (clamped 0..1.2).
  const rOuter = (dim - cfg.outerStroke) / 2;
  const circOuter = 2 * Math.PI * rOuter;
  const kcalRatio = useMemo(() => {
    if (kcalTarget == null || kcalTarget <= 0) return 0;
    return Math.max(0, Math.min(1.2, kcal / kcalTarget));
  }, [kcal, kcalTarget]);

  const kcalMv = useMotionValue(0);
  const kcalSpring = useSpring(kcalMv, { stiffness: 90, damping: 26, mass: 0.65 });
  const kcalDash = useTransform(kcalSpring, (v) => circOuter * (1 - Math.min(1, v)));
  const kcalText = useTransform(kcalSpring, (v) => Math.round(v * (kcalTarget ?? 0)).toString());

  // Inner macro arcs share a single track; each macro gets a fraction
  // of the circle proportional to its kcal contribution (4/4/9 rule).
  const rInner = rOuter - cfg.macroInset;
  const circInner = 2 * Math.PI * rInner;
  const macroParts = useMemo(() => splitMacros(macros), [macros]);
  const proteinMv = useMotionValue(0);
  const carbsMv = useMotionValue(0);
  const fatMv = useMotionValue(0);
  const proteinSpring = useSpring(proteinMv, { stiffness: 90, damping: 26, mass: 0.65 });
  const carbsSpring = useSpring(carbsMv, { stiffness: 90, damping: 26, mass: 0.65 });
  const fatSpring = useSpring(fatMv, { stiffness: 90, damping: 26, mass: 0.65 });
  // Use strokeDasharray to draw a fixed-length arc starting at the current
  // angular offset (computed via rotate on the circle element).
  const proteinLen = useTransform(proteinSpring, (v) => `${circInner * v} ${circInner}`);
  const carbsLen = useTransform(carbsSpring, (v) => `${circInner * v} ${circInner}`);
  const fatLen = useTransform(fatSpring, (v) => `${circInner * v} ${circInner}`);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      kcalMv.set(kcalRatio);
      proteinMv.set(macroParts.protein);
      carbsMv.set(macroParts.carbs);
      fatMv.set(macroParts.fat);
    });
    return () => cancelAnimationFrame(id);
  }, [kcalMv, kcalRatio, proteinMv, carbsMv, fatMv, macroParts.protein, macroParts.carbs, macroParts.fat]);

  // Macro arc rotation: cumulative start angles in degrees.
  const proteinStartDeg = -90;
  const carbsStartDeg = -90 + macroParts.protein * 360;
  const fatStartDeg = -90 + (macroParts.protein + macroParts.carbs) * 360;

  return (
    <div
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: dim, height: dim }}
    >
      <svg width={dim} height={dim} className="absolute inset-0">
        <defs>
          <linearGradient id={`ring-kcal-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="var(--color-nutrition)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--color-nutrition-2)" stopOpacity="0.85" />
          </linearGradient>
        </defs>

        {/* outer track */}
        <circle
          cx={cx}
          cy={cy}
          r={rOuter}
          stroke="var(--color-border)"
          strokeWidth={cfg.outerStroke}
          fill="none"
        />
        <motion.circle
          cx={cx}
          cy={cy}
          r={rOuter}
          stroke={`url(#ring-kcal-${size})`}
          strokeWidth={cfg.outerStroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circOuter}
          style={{ strokeDashoffset: kcalDash, transform: "rotate(-90deg)", transformOrigin: "center" }}
        />

        {/* inner macro arcs */}
        <circle
          cx={cx}
          cy={cy}
          r={rInner}
          stroke="var(--color-border)"
          strokeWidth={cfg.macroStroke}
          fill="none"
          opacity={0.35}
        />
        <motion.circle
          cx={cx}
          cy={cy}
          r={rInner}
          stroke="var(--color-nutrition)"
          strokeWidth={cfg.macroStroke}
          strokeLinecap="butt"
          fill="none"
          style={{
            strokeDasharray: proteinLen,
            transform: `rotate(${proteinStartDeg}deg)`,
            transformOrigin: "center",
          }}
        />
        <motion.circle
          cx={cx}
          cy={cy}
          r={rInner}
          stroke="var(--color-nutrition-2)"
          strokeWidth={cfg.macroStroke}
          strokeLinecap="butt"
          fill="none"
          style={{
            strokeDasharray: carbsLen,
            transform: `rotate(${carbsStartDeg}deg)`,
            transformOrigin: "center",
          }}
        />
        <motion.circle
          cx={cx}
          cy={cy}
          r={rInner}
          stroke="var(--color-temp)"
          strokeWidth={cfg.macroStroke}
          strokeLinecap="butt"
          fill="none"
          style={{
            strokeDasharray: fatLen,
            transform: `rotate(${fatStartDeg}deg)`,
            transformOrigin: "center",
          }}
        />
      </svg>

      <div className="grid place-items-center text-center leading-none">
        <motion.span
          className="num font-semibold tracking-[-0.02em] tabular-nums"
          style={{ fontSize: cfg.valueFs }}
        >
          {kcalTarget ? kcalText : kcal.toString()}
        </motion.span>
        <span
          className="text-caption mt-1"
          style={{ fontSize: cfg.captionFs }}
        >
          {kcalTarget ? `/${Math.round(kcalTarget)} kcal` : "kcal"}
        </span>
      </div>
    </div>
  );
}

function splitMacros(m: MacroSplit) {
  const p = Math.max(0, m.protein_g * 4);
  const c = Math.max(0, m.carbs_g * 4);
  const f = Math.max(0, m.fat_g * 9);
  const total = p + c + f;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: p / total, carbs: c / total, fat: f / total };
}
