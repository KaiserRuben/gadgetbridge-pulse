"use client";

import { motion } from "motion/react";
import type { PropsWithChildren } from "react";

import { useMotionPrefs } from "./_lib";

export function Stagger({
  children,
  step,
  delay = 0,
  className,
}: PropsWithChildren<{ step?: number; delay?: number; className?: string }>) {
  const prefs = useMotionPrefs();
  const stepResolved = step ?? prefs.staggerStep;
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: stepResolved,
            delayChildren: prefs.reduce ? 0 : delay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  distance,
}: PropsWithChildren<{ className?: string; distance?: number }>) {
  const prefs = useMotionPrefs();
  const y = distance ?? prefs.fadeRiseY;
  const dur = prefs.fadeRiseDur;
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: dur, ease: [0.16, 1, 0.3, 1] },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
