"use client";

import { useMemo } from "react";
import type { DynamicChartData } from "@/lib/queries/dynamic";
import { metricColor, metricLabel, metricUnitDisplay, formatMetricValue, isDurationMetric } from "./meta";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * Calendar heatmap of one metric over the spec's date range. Cells coloured
 * by value relative to range min/max. Layout adapts: ≤14 days = horizontal
 * strip; longer = grid by ISO week.
 */
export function CalendarChart({
  data,
}: {
  data: DynamicChartData;
}) {
  const metric = data.spec.metrics[0];
  const points = data.series[0]?.points ?? [];
  const stats = useMemo(() => {
    const xs = points.map((p) => p.value).filter((v): v is number => v != null);
    if (!xs.length) return null;
    return { min: Math.min(...xs), max: Math.max(...xs) };
  }, [points]);

  if (!stats) {
    return (
      <div className="grid place-items-center min-h-[160px] text-caption rounded-xl border border-dashed border-[var(--color-border)]">
        Keine Werte
      </div>
    );
  }

  const cells = points.map((p) => ({
    date: p.date,
    value: p.value,
    pct:
      p.value == null
        ? null
        : stats.min === stats.max
          ? 0.6
          : (p.value - stats.min) / (stats.max - stats.min),
  }));

  // Build a Mon-aligned grid: pad the first row up to the active weekday.
  const first = cells[0];
  if (!first) return null;
  const dowStart = (new Date(`${first.date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const grid: Array<typeof cells[number] | null> = [];
  for (let i = 0; i < dowStart; i++) grid.push(null);
  grid.push(...cells);

  const baseColor = metricColor(metric);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-caption text-center">
            {w}
          </span>
        ))}
        {grid.map((cell, i) => {
          if (!cell) return <span key={i} className="aspect-square" />;
          const opacity = cell.pct == null ? 0.05 : 0.18 + cell.pct * 0.7;
          return (
            <div
              key={cell.date}
              className="aspect-square rounded-md flex items-end justify-end p-0.5 text-[0.55rem] num-mono"
              style={{
                background: cell.value == null
                  ? "var(--color-surface-2)"
                  : `color-mix(in oklab, ${baseColor} ${opacity * 100}%, transparent)`,
                color: cell.pct != null && cell.pct > 0.5 ? "white" : "var(--color-text-muted)",
              }}
              title={`${cell.date}: ${formatMetricValue(metric, cell.value)}${metricUnitDisplay(metric) ? " " + metricUnitDisplay(metric) : ""}`}
            >
              {cell.value != null ? (isDurationMetric(metric) ? Math.round(cell.value / 60) : cell.value >= 100 ? Math.round(cell.value) : cell.value.toFixed(0)) : ""}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-caption">
        <span className="num-mono">
          {formatMetricValue(metric, stats.min, { compact: true })}–{formatMetricValue(metric, stats.max, { compact: true })}{metricUnitDisplay(metric) ? " " + metricUnitDisplay(metric) : ""}
        </span>
        <span>{metricLabel(metric)}</span>
      </div>
    </div>
  );
}

