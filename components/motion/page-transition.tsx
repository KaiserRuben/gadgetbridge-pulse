"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";

import { useMotionPrefs } from "./_lib";

export function PageTransition({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const prefs = useMotionPrefs();
  const y = prefs.reduce ? 0 : 4;
  const exitY = prefs.reduce ? 0 : -2;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={pathname}
        initial={{ opacity: 0, y }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: exitY }}
        transition={{
          duration: prefs.reduce ? 0 : 0.24,
          ease: [0.16, 1, 0.3, 1],
        }}
        className="min-h-dvh"
      >
        {children}
      </motion.main>
    </AnimatePresence>
  );
}
