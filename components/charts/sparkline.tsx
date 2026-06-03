"use client";

import { motion } from "motion/react";
import { useId, useMemo } from "react";

type Tone = "sleep" | "heart" | "activity" | "stress" | "body" | "hrv" | "neutral";

const toneColor: Record<Tone, string> = {
  sleep: "var(--color-sleep)",
  heart: "var(--color-heart)",
  activity: "var(--color-activity)",
  stress: "var(--color-stress)",
  body: "var(--color-temp)",
  hrv: "var(--color-hrv)",
  neutral: "var(--color-text-muted)",
};

/**
 * Inline trend sparkline. Accepts `(number | null)[]`; nulls render as gaps
 * (the stroke is broken across missing points rather than interpolated), so a
 * series with holes stays honest. A clean `number[]` renders exactly as before.
 */
export function Sparkline({
  values,
  tone = "neutral",
  height = 36,
  width = 120,
  fill = true,
  className,
}: {
  values: Array<number | null>;
  tone?: Tone;
  height?: number;
  width?: number;
  fill?: boolean;
  className?: string;
}) {
  const { segments, area, hasGaps, lastY } = useMemo(
    () => buildPath(values, width, height),
    [values, width, height],
  );
  const color = toneColor[tone];
  const reactId = useId();
  const present = values.filter((v): v is number => v != null);
  if (present.length < 2) {
    return <div className={className} style={{ height, width }} />;
  }
  const id = `spark-${tone}-${reactId.replace(/:/g, "")}`;
  return (
    <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && !hasGaps && area && (
        <motion.path
          d={area}
          fill={`url(#${id})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
      {segments.map((d, i) => (
        <motion.path
          key={i}
          d={d}
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: i * 0.04 }}
        />
      ))}
      {lastY != null && <circle cx={width} cy={lastY} r={2} fill={color} />}
    </svg>
  );
}

function buildPath(values: Array<number | null>, w: number, h: number) {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) {
    return { segments: [] as string[], area: "", hasGaps: false, lastY: null as number | null };
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  const range = max - min || 1;
  const step = w / Math.max(1, values.length - 1);
  const y = (v: number) => h - 2 - ((v - min) / range) * (h - 4);

  // Split into contiguous runs of present points; each run is its own path.
  const segments: string[] = [];
  let run: Array<readonly [number, number]> = [];
  const flush = (): void => {
    if (run.length === 1) {
      // a lone point: draw a 1px dot-dash so it is still visible
      const [x, py] = run[0];
      segments.push(`M${x},${py} L${x + 0.01},${py}`);
    } else if (run.length > 1) {
      segments.push(run.map(([x, py], i) => (i === 0 ? `M${x},${py}` : `L${x},${py}`)).join(""));
    }
    run = [];
  };
  values.forEach((v, i) => {
    if (v == null) {
      flush();
    } else {
      run.push([i * step, y(v)] as const);
    }
  });
  flush();

  const hasGaps = present.length !== values.length;
  // Area only for hole-free series (a gapped area reads as fake-filled data).
  let area = "";
  if (!hasGaps) {
    const pts = values.map((v, i) => [i * step, y(v as number)] as const);
    const d = pts.map(([x, py], i) => (i === 0 ? `M${x},${py}` : `L${x},${py}`)).join("");
    area = `${d} L${w},${h} L0,${h} Z`;
  }

  // trailing dot only when the final point is present (else it would float
  // at the right edge over a gap)
  const lastVal = values[values.length - 1];
  const lastY = lastVal != null ? y(lastVal) : null;
  return { segments, area, hasGaps, lastY };
}
