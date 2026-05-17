"use client";

import { motion } from "motion/react";
import type { PropsWithChildren } from "react";

export function Stagger({
  children,
  step = 0.05,
  delay = 0,
  className,
}: PropsWithChildren<{ step?: number; delay?: number; className?: string }>) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: step, delayChildren: delay } },
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
  distance = 6,
}: PropsWithChildren<{ className?: string; distance?: number }>) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: distance },
        show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
