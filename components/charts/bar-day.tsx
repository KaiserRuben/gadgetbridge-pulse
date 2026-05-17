"use client";

import { motion } from "motion/react";

export function BarDay({
  buckets,
  label = "Schritte",
  height = 100,
  tone = "activity",
}: {
  /** 24-element array of values, indexed by hour 0-23 */
  buckets: number[];
  label?: string;
  height?: number;
  tone?: "activity" | "stress" | "heart" | "sleep";
}) {
  const max = Math.max(1, ...buckets);
  const color =
    tone === "stress" ? "var(--color-stress)"
    : tone === "heart" ? "var(--color-heart)"
    : tone === "sleep" ? "var(--color-sleep)"
    : "var(--color-activity)";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {buckets.map((v, i) => {
          const h = Math.max(2, (v / max) * height);
          return (
            <motion.div
              key={i}
              className="flex-1 rounded-[3px]"
              style={{ background: color, height: h }}
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: v === 0 ? 0.18 : 0.8 }}
              transition={{ duration: 0.32, delay: i * 0.012, ease: [0.16, 1, 0.3, 1] }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-caption">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}
