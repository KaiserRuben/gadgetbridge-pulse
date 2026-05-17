"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { PropsWithChildren } from "react";

type Props = PropsWithChildren<
  HTMLMotionProps<"div"> & {
    delay?: number;
    distance?: number;
    duration?: number;
  }
>;

export function FadeRise({
  delay = 0,
  distance = 6,
  duration = 0.32,
  children,
  ...rest
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: distance }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
