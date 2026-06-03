"use client";

import { animate, useInView, useMotionValue, useTransform } from "motion/react";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";

import { useMotionPrefs } from "./_lib";

export function NumberTicker({
  value,
  duration = 1.2,
  decimals = 0,
  className,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // No negative root margin: a hero number pinned to the very top of a small
  // (mobile) viewport would never satisfy a shrunk intersection box and, with
  // `once`, stay parked at 0 forever. Default margin fires as soon as any part
  // is visible.
  const inView = useInView(ref, { once: true });
  const prefs = useMotionPrefs();
  const m = useMotionValue(prefs.reduce ? value : 0);
  const text = useTransform(m, (v) =>
    decimals === 0
      ? Math.round(v).toLocaleString("de-DE")
      : v.toLocaleString("de-DE", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }),
  );

  useEffect(() => {
    if (prefs.reduce) {
      m.set(value);
      return;
    }
    if (!inView) return;
    const ctrl = animate(m, value, { duration, ease: [0.16, 1, 0.3, 1] });
    return () => ctrl.stop();
  }, [inView, m, value, duration, prefs.reduce]);

  return (
    <motion.span ref={ref} className={className}>
      {text}
    </motion.span>
  );
}
