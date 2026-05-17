"use client";

import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { DynamicChartData } from "@/lib/queries/dynamic";
import { metricColor, metricLabel, formatMetricValue } from "./meta";

export function TrendChart({ data, height = 240 }: { data: DynamicChartData; height?: number }) {
  const dates = (data.series[0]?.points ?? []).map((p) => p.date);
  const merged = dates.map((date, i) => {
    const row: Record<string, number | string | null> = { date };
    for (const s of data.series) {
      row[s.metric] = s.points[i]?.value ?? null;
    }
    return row;
  });

  const baseline = data.baseline ?? {};
  const primaryMetric = data.spec.metrics[0] ?? data.series[0]?.metric ?? "";

  if (merged.length === 0) {
    return <Empty height={height} />;
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={merged} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {data.series.map((s) => (
              <linearGradient key={s.metric} id={`g-${s.metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={metricColor(s.metric)} stopOpacity="0.45" />
                <stop offset="100%" stopColor={metricColor(s.metric)} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            stroke="var(--color-text-faint)"
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtDate}
            minTickGap={28}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            stroke="var(--color-text-faint)"
            width={42}
            tickFormatter={(v: number) => formatMetricValue(primaryMetric, v, { compact: true })}
          />
          {Object.entries(baseline).map(([m, v]) =>
            v == null ? null : (
              <ReferenceLine
                key={`b-${m}`}
                y={v}
                stroke={metricColor(m)}
                strokeDasharray="4 3"
                strokeOpacity={0.6}
                ifOverflow="visible"
              />
            ),
          )}
          {data.series.map((s, i) =>
            i === 0 ? (
              <Area
                key={s.metric}
                dataKey={s.metric}
                type="monotone"
                stroke={metricColor(s.metric)}
                strokeWidth={1.75}
                fill={`url(#g-${s.metric})`}
                connectNulls
                isAnimationActive
                animationDuration={500}
              />
            ) : (
              <Line
                key={s.metric}
                dataKey={s.metric}
                type="monotone"
                stroke={metricColor(s.metric)}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive
                animationDuration={500}
              />
            ),
          )}
          <Tooltip
            cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                  <div className="text-subtle mb-1">{fmtDate(label as string)}</div>
                  {payload.map((p) => {
                    const m = String(p.dataKey);
                    return (
                      <div key={m} className="num-mono flex gap-2 items-baseline">
                        <span className="opacity-70">{metricLabel(m)}</span>
                        <span style={{ color: p.color }}>
                          {formatMetricValue(m, typeof p.value === "number" ? p.value : null)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div
      className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)]"
      style={{ height }}
    >
      Keine Daten in diesem Zeitraum
    </div>
  );
}

function fmtDate(d: string) {
  const [, m, day] = d.split("-");
  return `${day}.${m}`;
}
