"use client";

import { useReducedMotion } from "motion/react";

/**
 * Centralised motion preferences. Every motion primitive reads from here so a
 * single OS-level `prefers-reduced-motion: reduce` toggle disables fade/rise/
 * stagger/ticker behaviour consistently across the dashboard.
 *
 * Per OQ-2: motion is reserved for cells/dialogs/async-arrival surfaces.
 * Static page content should not animate by default. Call-site overrides
 * (explicit `distance`, `duration`, `step` props) win over these defaults so
 * existing APIs remain back-compat.
 */
export interface MotionPrefs {
  /** True when the OS reports prefers-reduced-motion: reduce. */
  reduce: boolean;
  /** Default y-offset for FadeRise. 0 when reduced. */
  fadeRiseY: number;
  /** Default duration (s) for FadeRise. 0 when reduced. */
  fadeRiseDur: number;
  /** Default staggerChildren step (s) for Stagger. 0 when reduced. */
  staggerStep: number;
  /** Cross-fade duration (s) for AnimatePresence swaps. 0 when reduced. */
  crossfadeDur: number;
  /** Spring stiffness for layout transitions. Infinity = snap when reduced. */
  springStiffness: number;
}

export function useMotionPrefs(): MotionPrefs {
  const reduce = useReducedMotion();
  return {
    reduce: reduce === true,
    fadeRiseY: reduce ? 0 : 6,
    fadeRiseDur: reduce ? 0 : 0.32,
    staggerStep: reduce ? 0 : 0.05,
    crossfadeDur: reduce ? 0 : 0.18,
    springStiffness: reduce ? Infinity : 320,
  };
}
