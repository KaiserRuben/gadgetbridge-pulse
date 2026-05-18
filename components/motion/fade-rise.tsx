"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { PropsWithChildren } from "react";

import { useMotionPrefs } from "./_lib";

type Props = PropsWithChildren<
  HTMLMotionProps<"div"> & {
    delay?: number;
    distance?: number;
    duration?: number;
  }
>;

export function FadeRise({
  delay = 0,
  distance,
  duration,
  children,
  ...rest
}: Props) {
  const prefs = useMotionPrefs();
  const y = distance ?? prefs.fadeRiseY;
  const dur = duration ?? prefs.fadeRiseDur;
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: dur,
        delay: prefs.reduce ? 0 : delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
