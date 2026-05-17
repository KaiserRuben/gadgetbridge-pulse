"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DynamicChartData } from "@/lib/queries/dynamic";
import { metricColor, metricLabel, formatMetricValue } from "./meta";

/**
 * Multi-metric stacked bars + optional overlay line. First metric is bars,
 * subsequent metrics are dotted lines on a secondary y-axis. Useful for
 * "training_load + acwr", "steps + active_minutes", etc.
 */
export function StackedChart({
  data,
  height = 260,
}: {
  data: DynamicChartData;
  height?: number;
}) {
  const dates = (data.series[0]?.points ?? []).map((p) => p.date);
  const merged = dates.map((date, i) => {
    const row: Record<string, number | string | null> = { date };
    for (const s of data.series) row[s.metric] = s.points[i]?.value ?? null;
    return row;
  });

  if (merged.length === 0) {
    return (
      <div
        className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)]"
        style={{ height }}
      >
        Keine Daten
      </div>
    );
  }

  const [primary, ...rest] = data.spec.metrics;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={merged} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
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
            yAxisId="primary"
            tickLine={false}
            axisLine={false}
            stroke="var(--color-text-faint)"
            width={42}
            tickFormatter={(v: number) => formatMetricValue(primary, v, { compact: true })}
          />
          {rest.length > 0 && (
            <YAxis
              yAxisId="secondary"
              orientation="right"
              tickLine={false}
              axisLine={false}
              stroke="var(--color-text-faint)"
              width={36}
              tickFormatter={(v: number) => formatMetricValue(rest[0], v, { compact: true })}
            />
          )}
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)", opacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                  <div className="text-subtle mb-1">{fmtDate(label as string)}</div>
                  {payload.map((p) => {
                    const m = String(p.dataKey);
                    return (
                      <div key={m} className="num-mono flex gap-2">
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
          <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-text-muted)" }} />
          <Bar
            yAxisId="primary"
            dataKey={primary}
            name={metricLabel(primary)}
            fill={metricColor(primary)}
            radius={[4, 4, 0, 0]}
            isAnimationActive
            animationDuration={500}
          />
          {rest.map((m) => (
            <Line
              key={m}
              yAxisId="secondary"
              dataKey={m}
              name={metricLabel(m)}
              type="monotone"
              stroke={metricColor(m)}
              strokeDasharray="3 3"
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive
              animationDuration={500}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmtDate(d: string) {
  const [, m, day] = d.split("-");
  return `${day}.${m}`;
}
