"use client";

import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { DynamicChartData } from "@/lib/queries/dynamic";
import { metricColor, metricLabel, formatMetricValue } from "./meta";

/**
 * Side-by-side bars per date: current period vs comparison period (or
 * baseline aggregate). For multi-metric specs we render the FIRST metric
 * only — comparison charts are inherently 1-D.
 */
export function ComparisonChart({ data, height = 240 }: { data: DynamicChartData; height?: number }) {
  const metric = data.spec.metrics[0];
  if (!metric) return <Empty height={height} />;

  const cur = data.series[0]?.points ?? [];
  const cmp = data.comparison?.[0]?.points ?? null;
  const baseline = data.baseline?.[metric] ?? null;

  // Two-window mode: align by index (per-day pair).
  if (cmp) {
    const n = Math.max(cur.length, cmp.length);
    const rows = Array.from({ length: n }, (_, i) => ({
      label: cur[i]?.date ? fmtDate(cur[i]!.date) : `${i + 1}`,
      current: cur[i]?.value ?? null,
      previous: cmp[i]?.value ?? null,
    }));
    return (
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              stroke="var(--color-text-faint)"
              tickLine={false}
              axisLine={false}
              minTickGap={20}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              stroke="var(--color-text-faint)"
              width={42}
              tickFormatter={(v: number) => formatMetricValue(metric, v, { compact: true })}
            />
            <Tooltip
              cursor={{ fill: "var(--color-surface-2)", opacity: 0.4 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                    <div className="text-subtle mb-1">{label}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="num-mono flex gap-2">
                        <span className="opacity-70">{p.name}</span>
                        <span style={{ color: p.color }}>
                          {formatMetricValue(metric, typeof p.value === "number" ? p.value : null)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-text-muted)" }} />
            <Bar
              dataKey="current"
              name={`${metricLabel(metric)} (aktuell)`}
              fill={metricColor(metric)}
              radius={[4, 4, 0, 0]}
              isAnimationActive
              animationDuration={500}
            />
            <Bar
              dataKey="previous"
              name="Vergleich"
              fill={`color-mix(in oklab, ${metricColor(metric)} 40%, transparent)`}
              radius={[4, 4, 0, 0]}
              isAnimationActive
              animationDuration={500}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Aggregate-baseline mode: single bar series with a horizontal reference.
  const rows = cur.map((p) => ({
    label: fmtDate(p.date),
    value: p.value,
  }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--color-text-faint)"
            tickLine={false}
            axisLine={false}
            minTickGap={20}
          />
          <YAxis tickLine={false} axisLine={false} stroke="var(--color-text-faint)" width={36} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)", opacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                  <div className="text-subtle mb-1">{label}</div>
                  <div className="num-mono">
                    {metricLabel(metric)}: {formatMetricValue(metric, typeof payload[0].value === "number" ? payload[0].value : null)}
                  </div>
                  {baseline != null && (
                    <div className="num-mono text-subtle">Baseline: {formatMetricValue(metric, baseline)}</div>
                  )}
                </div>
              );
            }}
          />
          <Bar
            dataKey="value"
            name={metricLabel(metric)}
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

function Empty({ height }: { height: number }) {
  return (
    <div
      className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)]"
      style={{ height }}
    >
      Keine Daten
    </div>
  );
}

function fmtDate(d: string) {
  const [, m, day] = d.split("-");
  return `${day}.${m}`;
}
