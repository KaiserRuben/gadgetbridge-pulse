"use client";

import { motion } from "motion/react";
import { useId, useMemo } from "react";

type Tone = "sleep" | "heart" | "activity" | "stress" | "body" | "neutral";

const toneColor: Record<Tone, string> = {
  sleep: "var(--color-sleep)",
  heart: "var(--color-heart)",
  activity: "var(--color-activity)",
  stress: "var(--color-stress)",
  body: "var(--color-temp)",
  neutral: "var(--color-text-muted)",
};

export function Sparkline({
  values,
  tone = "neutral",
  height = 36,
  width = 120,
  fill = true,
  className,
}: {
  values: number[];
  tone?: Tone;
  height?: number;
  width?: number;
  fill?: boolean;
  className?: string;
}) {
  const { d, area, last, lastY } = useMemo(() => buildPath(values, width, height), [values, width, height]);
  const color = toneColor[tone];
  const reactId = useId();
  if (values.length < 2) {
    return <div className={className} style={{ height, width }} />;
  }
  const id = `spark-${tone}-${reactId.replace(/:/g, "")}`;
  return (
    <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0"   />
        </linearGradient>
      </defs>
      {fill && (
        <motion.path
          d={area}
          fill={`url(#${id})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
      <motion.path
        d={d}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />
      {last != null && (
        <circle cx={width} cy={lastY} r={2} fill={color} />
      )}
    </svg>
  );
}

function buildPath(values: number[], w: number, h: number) {
  if (values.length === 0) return { d: "", area: "", last: null as number | null, lastY: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / Math.max(1, values.length - 1);
  const y = (v: number) => h - 2 - ((v - min) / range) * (h - 4);
  const pts = values.map((v, i) => [i * step, y(v)] as const);
  const d = pts.map(([x, py], i) => (i === 0 ? `M${x},${py}` : `L${x},${py}`)).join("");
  const area = `${d} L${w},${h} L0,${h} Z`;
  return { d, area, last: values[values.length - 1], lastY: pts[pts.length - 1][1] };
}
