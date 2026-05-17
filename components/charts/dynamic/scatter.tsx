"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { DynamicChartData } from "@/lib/queries/dynamic";
import { metricColor, metricLabel, metricUnitDisplay, formatMetricValue } from "./meta";

/**
 * Two-metric scatter (correlation view). Pairs by date — only days where
 * BOTH metrics are present render as a point.
 */
export function ScatterChartDynamic({
  data,
  height = 260,
}: {
  data: DynamicChartData;
  height?: number;
}) {
  const xMetric = data.spec.metrics[0];
  const yMetric = data.spec.metrics[1] ?? data.spec.metrics[0];
  const xPoints = data.series[0]?.points ?? [];
  const yPoints = data.series[1]?.points ?? data.series[0]?.points ?? [];

  const points: Array<{ x: number; y: number; date: string }> = [];
  const byDate = new Map(yPoints.map((p) => [p.date, p.value]));
  for (const xp of xPoints) {
    const y = byDate.get(xp.date);
    if (xp.value != null && y != null) {
      points.push({ x: xp.value, y, date: xp.date });
    }
  }

  if (points.length < 2) {
    return (
      <div
        className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)]"
        style={{ height }}
      >
        Zu wenig Datenpaare
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="x"
            name={metricLabel(xMetric)}
            domain={["dataMin", "dataMax"]}
            stroke="var(--color-text-faint)"
            tickLine={false}
            label={{
              value: `${metricLabel(xMetric)}${metricUnitDisplay(xMetric) ? " (" + metricUnitDisplay(xMetric) + ")" : ""}`,
              position: "insideBottom",
              offset: -8,
              fill: "var(--color-text-muted)",
              fontSize: 11,
            }}
            tickFormatter={(v: number) => formatMetricValue(xMetric, v, { compact: true })}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={metricLabel(yMetric)}
            domain={["dataMin", "dataMax"]}
            stroke="var(--color-text-faint)"
            tickLine={false}
            width={42}
            tickFormatter={(v: number) => formatMetricValue(yMetric, v, { compact: true })}
          />
          <ZAxis range={[60, 60]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { x: number; y: number; date: string };
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                  <div className="text-subtle">{p.date}</div>
                  <div className="num-mono">
                    {metricLabel(xMetric)}: {formatMetricValue(xMetric, p.x)}
                  </div>
                  <div className="num-mono">
                    {metricLabel(yMetric)}: {formatMetricValue(yMetric, p.y)}
                  </div>
                </div>
              );
            }}
          />
          <Scatter
            data={points}
            fill={metricColor(xMetric)}
            isAnimationActive
            animationDuration={500}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

