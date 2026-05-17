"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import type { DynamicChartData } from "@/lib/queries/dynamic";
import { metricColor, metricLabel, metricUnitDisplay, formatMetricValue } from "./meta";

const BIN_COUNT = 10;

export function DistributionChart({
  data,
  height = 240,
}: {
  data: DynamicChartData;
  height?: number;
}) {
  const metric = data.spec.metrics[0];
  const points = data.series[0]?.points ?? [];
  const values = points.map((p) => p.value).filter((v): v is number => v != null);

  const bins = useMemo(() => binValues(values, BIN_COUNT, metric), [values, metric]);

  if (!values.length) return <Empty height={height} />;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={bins} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--color-text-faint)"
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <YAxis tickLine={false} axisLine={false} stroke="var(--color-text-faint)" width={28} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)", opacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                  <div className="text-subtle mb-1">
                    {metricLabel(metric)} {label}{metricUnitDisplay(metric) ? " " + metricUnitDisplay(metric) : ""}
                  </div>
                  <div className="num-mono">{payload[0].value} Tage</div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="count"
            fill={metricColor(metric)}
            radius={[4, 4, 0, 0]}
            isAnimationActive
            animationDuration={500}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function binValues(xs: number[], n: number, metric: string): Array<{ label: string; count: number }> {
  if (!xs.length) return [];
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const fmt = (v: number) => formatMetricValue(metric, v, { compact: true });
  if (min === max) return [{ label: fmt(min), count: xs.length }];
  const step = (max - min) / n;
  const buckets = Array.from({ length: n }, () => 0);
  for (const v of xs) {
    const idx = Math.min(n - 1, Math.floor((v - min) / step));
    buckets[idx]++;
  }
  return buckets.map((count, i) => ({
    label: `${fmt(min + i * step)}–${fmt(min + (i + 1) * step)}`,
    count,
  }));
}

function Empty({ height }: { height: number }) {
  return (
    <div
      className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)]"
      style={{ height }}
    >
      Keine Werte
    </div>
  );
}
