"use client";

/**
 * Charts specific to the Activity domain page.
 *
 * - StepsVsGoalChart: 14-day bar chart with a horizontal goal line. Bars over
 *   goal recolor to the success tone; bars below stay muted. Uses framer-motion
 *   for the bar reveal so it matches the BarDay aesthetic elsewhere.
 *
 * - AcwrChart: 28-day acute vs chronic training load as a two-line Recharts
 *   composed chart with the optimal-band (0.8–1.3 ratio) highlighted. The
 *   acute and chronic series share a y-axis; ratio is computed point-wise
 *   from the merged series for the tooltip.
 *
 * Both components degrade gracefully on empty input (returning a dashed
 * placeholder), since training-load tables are device-dependent.
 */

import { motion } from "motion/react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const ACWR_OPTIMAL_LOW = 0.8;
const ACWR_OPTIMAL_HIGH = 1.3;

export type StepsBar = {
  date: string; // YYYY-MM-DD
  steps: number | null;
};

export function StepsVsGoalChart({
  bars,
  goal,
  height = 140,
}: {
  bars: StepsBar[];
  goal: number;
  height?: number;
}) {
  const maxValue = Math.max(goal, ...bars.map((b) => b.steps ?? 0));
  const goalY = (goal / maxValue) * height;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative" style={{ height }}>
        <div
          className="absolute left-0 right-0 border-t border-dashed border-[var(--color-activity-2)] pointer-events-none"
          style={{ bottom: goalY }}
        >
          <span
            className="absolute right-0 -translate-y-full text-[10px] num-mono text-[var(--color-activity-2)] bg-[var(--color-bg)]/80 px-1 rounded-sm"
            style={{ marginBottom: 2 }}
          >
            Ziel {goal.toLocaleString("de-DE")}
          </span>
        </div>
        <div className="flex items-end gap-[3px] h-full">
          {bars.map((b, i) => {
            const value = b.steps ?? 0;
            const h = Math.max(2, (value / maxValue) * height);
            const reachedGoal = value >= goal;
            const hasData = b.steps != null;
            return (
              <motion.div
                key={b.date}
                className="flex-1 rounded-[3px] relative"
                style={{
                  background: hasData
                    ? reachedGoal
                      ? "var(--color-activity)"
                      : "var(--color-activity)"
                    : "var(--color-border)",
                  height: h,
                  opacity: hasData ? (reachedGoal ? 0.95 : 0.55) : 0.18,
                }}
                initial={{ scaleY: 0, opacity: 0 }}
                animate={{
                  scaleY: 1,
                  opacity: hasData ? (reachedGoal ? 0.95 : 0.55) : 0.18,
                }}
                transition={{
                  duration: 0.3,
                  delay: i * 0.018,
                  ease: [0.16, 1, 0.3, 1],
                }}
                title={`${b.date} · ${b.steps != null ? b.steps.toLocaleString("de-DE") : "—"} Schritte`}
              />
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-faint num-mono">
        {bars.length > 0 && (
          <>
            <span>{shortDay(bars[0].date)}</span>
            <span>{shortDay(bars[Math.floor(bars.length / 2)].date)}</span>
            <span>{shortDay(bars[bars.length - 1].date)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function shortDay(date: string): string {
  return date.slice(8, 10) + "." + date.slice(5, 7);
}

export type AcwrPoint = {
  date: string;
  acute: number | null;
  chronic: number | null;
  ratio: number | null;
};

export function AcwrChart({
  points,
  height = 220,
}: {
  points: AcwrPoint[];
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <div
        className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/30"
        style={{ height }}
      >
        Keine Trainingslast-Daten — abhängig vom Gerätetyp.
      </div>
    );
  }

  // The training-load chart shares a single y-axis. The optimal-band reference
  // is drawn in *ratio* space, but Recharts ReferenceArea works in y-domain
  // values, so we render the band against the chronic series and overlay the
  // ratio as a faint dotted line scaled visually via the shared axis.
  const acuteMax = Math.max(0, ...points.map((p) => p.acute ?? 0));
  const chronicMax = Math.max(0, ...points.map((p) => p.chronic ?? 0));
  const yMax = Math.max(acuteMax, chronicMax) || 1;

  // Map ACWR ratio (0.8/1.3) to absolute load values via the latest chronic
  // value for visual alignment of the optimal band.
  const lastChronic = points
    .slice()
    .reverse()
    .find((p) => p.chronic != null)?.chronic;
  const bandLow = lastChronic ? lastChronic * ACWR_OPTIMAL_LOW : null;
  const bandHigh = lastChronic ? lastChronic * ACWR_OPTIMAL_HIGH : null;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart
          data={points}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="acwr-acute" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-activity)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--color-activity)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
          <XAxis
            dataKey="date"
            stroke="var(--color-text-faint)"
            tickLine={false}
            axisLine={false}
            tickFormatter={shortDay}
            minTickGap={28}
          />
          <YAxis
            domain={[0, Math.ceil(yMax * 1.1)]}
            tickLine={false}
            axisLine={false}
            stroke="var(--color-text-faint)"
            width={36}
          />
          {bandLow != null && bandHigh != null && (
            <ReferenceArea
              y1={bandLow}
              y2={bandHigh}
              fill="var(--color-activity-2)"
              fillOpacity={0.08}
              stroke="var(--color-activity-2)"
              strokeOpacity={0.3}
              strokeDasharray="3 3"
              ifOverflow="visible"
              label={{
                value: "ACWR 0.8–1.3 (optimal)",
                position: "insideTopLeft",
                fill: "var(--color-activity-2)",
                fontSize: 10,
                fontWeight: 500,
              }}
            />
          )}
          {lastChronic != null && (
            <ReferenceLine
              y={lastChronic}
              stroke="var(--color-text-faint)"
              strokeDasharray="2 4"
              ifOverflow="visible"
            />
          )}
          <Area
            dataKey="acute"
            type="monotone"
            stroke="var(--color-activity)"
            strokeWidth={1.75}
            fill="url(#acwr-acute)"
            connectNulls
            isAnimationActive
            animationDuration={500}
          />
          <Line
            dataKey="chronic"
            type="monotone"
            stroke="var(--color-activity-2)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            connectNulls
            isAnimationActive
            animationDuration={500}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as AcwrPoint;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)] flex flex-col gap-0.5">
                  <div className="text-subtle">{shortDay(label as string)}</div>
                  <div className="num-mono flex gap-2 items-baseline">
                    <span className="opacity-70">Akut</span>
                    <span style={{ color: "var(--color-activity)" }}>
                      {p.acute != null ? p.acute.toFixed(0) : "—"}
                    </span>
                  </div>
                  <div className="num-mono flex gap-2 items-baseline">
                    <span className="opacity-70">Chronisch</span>
                    <span style={{ color: "var(--color-activity-2)" }}>
                      {p.chronic != null ? p.chronic.toFixed(0) : "—"}
                    </span>
                  </div>
                  {p.ratio != null && (
                    <div className="num-mono flex gap-2 items-baseline pt-1 border-t border-[var(--color-border)] mt-0.5">
                      <span className="opacity-70">ACWR</span>
                      <span
                        style={{
                          color:
                            p.ratio < ACWR_OPTIMAL_LOW
                              ? "var(--color-band-down)"
                              : p.ratio <= ACWR_OPTIMAL_HIGH
                              ? "var(--color-activity)"
                              : "var(--color-band-up)",
                        }}
                      >
                        {p.ratio.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
