"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Brush,
} from "recharts";
import { useMemo, useState } from "react";

export type TimelinePoint = { ts: number; v: number };

type Tone = "heart" | "sleep" | "stress" | "body" | "activity";

const toneColor: Record<Tone, string> = {
  heart:    "var(--color-heart)",
  sleep:    "var(--color-sleep)",
  stress:   "var(--color-stress)",
  body:     "var(--color-temp)",
  activity: "var(--color-activity)",
};

export function Timeline({
  data,
  tone = "heart",
  unit = "",
  height = 220,
  brush = false,
  bands,
  highlightTs,
  yDomain,
}: {
  data: TimelinePoint[];
  tone?: Tone;
  unit?: string;
  height?: number;
  brush?: boolean;
  bands?: { from: number; to: number; color: string; label?: string }[];
  highlightTs?: number;
  yDomain?: [number, number];
}) {
  const color = toneColor[tone];
  const id = useMemo(() => `tl-${tone}-${Math.random().toString(36).slice(2, 7)}`, [tone]);
  const [_hover, setHover] = useState<number | null>(null);
  void _hover;

  if (data.length < 2) {
    return (
      <div
        className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/30"
        style={{ height }}
      >
        Keine Daten in diesem Zeitraum
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height }} onMouseLeave={() => setHover(null)}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: brush ? 8 : 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.45" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtClock}
            stroke="var(--color-text-faint)"
            tickLine={false}
            axisLine={false}
            minTickGap={36}
          />
          <YAxis
            domain={yDomain ?? [(min: number) => Math.floor(min - 5), (max: number) => Math.ceil(max + 5)]}
            tickLine={false}
            axisLine={false}
            stroke="var(--color-text-faint)"
            width={32}
          />
          {bands?.map((b, i) => (
            <ReferenceArea
              key={i}
              y1={b.from}
              y2={b.to}
              fill={b.color}
              fillOpacity={0.06}
              ifOverflow="visible"
            />
          ))}
          {highlightTs != null && (
            <ReferenceLine
              x={highlightTs}
              stroke={color}
              strokeWidth={2}
              strokeDasharray="4 3"
              ifOverflow="visible"
              label={{
                value: fmtClock(highlightTs),
                position: "top",
                fill: color,
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
          <Tooltip
            cursor={{ stroke: "var(--color-border-strong)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as TimelinePoint;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                  <div className="num-mono text-[var(--color-text)]">{Math.round(p.v)} {unit}</div>
                  <div className="text-subtle">{fmtClockFull(p.ts)}</div>
                </div>
              );
            }}
          />
          <Area
            dataKey="v"
            type="monotone"
            stroke={color}
            strokeWidth={1.75}
            strokeLinecap="round"
            fill={`url(#${id})`}
            isAnimationActive
            animationDuration={500}
          />
          {brush && (
            <Brush
              dataKey="ts"
              height={20}
              travellerWidth={8}
              stroke="var(--color-border-strong)"
              fill="var(--color-bg)"
              tickFormatter={fmtClock}
              onChange={(r) => setHover(r?.startIndex ?? null)}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmtClock(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}
function fmtClockFull(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
