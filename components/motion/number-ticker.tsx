"use client";

import { animate, useInView, useMotionValue, useTransform } from "motion/react";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";

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
  const inView = useInView(ref, { once: true, margin: "-20%" });
  const m = useMotionValue(0);
  const text = useTransform(m, (v) =>
    decimals === 0 ? Math.round(v).toString() : v.toFixed(decimals),
  );

  useEffect(() => {
    if (!inView) return;
    const ctrl = animate(m, value, { duration, ease: [0.16, 1, 0.3, 1] });
    return () => ctrl.stop();
  }, [inView, m, value, duration]);

  return (
    <motion.span ref={ref} className={className}>
      {text}
    </motion.span>
  );
}
