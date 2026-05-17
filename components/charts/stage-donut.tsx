"use client";

import { motion } from "motion/react";
import { SLEEP_STAGE } from "@/lib/constants";

type StageMin = Record<1 | 2 | 3 | 4, number>;

export function StageDonut({
  durations,
  size = 160,
  stroke = 14,
}: {
  durations: StageMin;
  size?: number;
  stroke?: number;
}) {
  const total = (durations[1] + durations[2] + durations[3] + durations[4]) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const arcs = ([3, 2, 1, 4] as const).map((stageNum) => {
    const len = (durations[stageNum] / total) * c;
    const a = { stage: stageNum, color: SLEEP_STAGE[stageNum].color, dash: len, off: offset, mins: durations[stageNum] };
    offset += len;
    return a;
  });

  const sleep = durations[1] + durations[2] + durations[3];

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-border)" strokeWidth={stroke} fill="none" />
        {arcs.map((a, i) => (
          <motion.circle
            key={a.stage}
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={a.color}
            strokeWidth={stroke}
            strokeDasharray={`${a.dash} ${c}`}
            initial={{ strokeDashoffset: c, opacity: 0 }}
            animate={{ strokeDashoffset: -a.off, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="grid place-items-center text-center">
        <span className="num text-[1.5rem] font-semibold leading-none">{fmtH(sleep)}</span>
        <span className="text-caption mt-0.5">Schlaf</span>
      </div>
    </div>
  );
}

function fmtH(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
