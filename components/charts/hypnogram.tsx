"use client";

import { motion } from "motion/react";
import type { SleepStageBlock } from "@/lib/types";
import { SLEEP_STAGE } from "@/lib/constants";

const STAGE_ORDER = [3, 2, 1, 4] as const; // deep at top, awake at bottom (visual depth)
const ROW_LABEL: Record<1 | 2 | 3 | 4, string> = { 3: "Tief", 2: "REM", 1: "Leicht", 4: "Wach" };

export function Hypnogram({
  blocks,
  windowStart,
  windowEnd,
  height = 160,
}: {
  blocks: SleepStageBlock[];
  windowStart: number;
  windowEnd: number;
  height?: number;
}) {
  if (blocks.length === 0 || windowEnd <= windowStart) {
    return (
      <div
        className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/30"
        style={{ height }}
      >
        Keine Schlafdaten
      </div>
    );
  }
  const total = windowEnd - windowStart;
  const rowH = (height - 24) / STAGE_ORDER.length;

  return (
    <div className="relative" style={{ height }}>
      <svg width="100%" height={height} role="img" aria-label="Schlafphasen">
        {STAGE_ORDER.map((stage, i) => {
          const stageNum = stage as 1 | 2 | 3 | 4;
          const y = i * rowH;
          return (
            <g key={stage}>
              <line
                x1="0" x2="100%" y1={y + rowH / 2} y2={y + rowH / 2}
                stroke="var(--color-border)" strokeDasharray="2 4" opacity={0.4}
              />
              <text
                x={0} y={y + rowH / 2 + 4}
                className="num-mono"
                fontSize={10}
                fill="var(--color-text-subtle)"
              >
                {ROW_LABEL[stageNum]}
              </text>
              {blocks
                .filter((b) => b.stage === stage)
                .map((b, idx) => {
                  const left = ((b.start - windowStart) / total) * 100;
                  const width = ((b.end - b.start) / total) * 100;
                  const color = SLEEP_STAGE[stageNum].color;
                  return (
                    <motion.rect
                      key={`${stage}-${idx}`}
                      x={`${left}%`}
                      y={y + 6}
                      width={`${Math.max(0.2, width)}%`}
                      height={rowH - 12}
                      rx={3}
                      fill={color}
                      fillOpacity={0.78}
                      initial={{ opacity: 0, scaleY: 0.6 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      transition={{ duration: 0.45, delay: idx * 0.012, ease: [0.16, 1, 0.3, 1] }}
                      style={{ transformOrigin: `0 ${y + rowH / 2}px` }}
                    />
                  );
                })}
            </g>
          );
        })}
        {/* hour ticks */}
        {ticks(windowStart, windowEnd).map((t, i) => {
          const x = ((t - windowStart) / total) * 100;
          return (
            <g key={i}>
              <line
                x1={`${x}%`} x2={`${x}%`} y1={0} y2={height - 14}
                stroke="var(--color-border)" opacity={0.25}
              />
              <text
                x={`${x}%`} y={height - 2}
                fontSize={10}
                fill="var(--color-text-subtle)"
                className="num-mono"
                textAnchor="middle"
              >
                {fmtTick(t)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ticks(start: number, end: number): number[] {
  const out: number[] = [];
  const span = end - start;
  const step = span / 6;
  for (let i = 1; i < 6; i++) out.push(start + step * i);
  return out;
}
function fmtTick(t: number) {
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}
