"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DistributionBin,
  MetricDetail,
  WeekOverlayDay,
  SampleRow,
} from "@/lib/explore-metric-detail-types";

type Tone = "sleep" | "heart" | "activity" | "stress" | "body";

const toneVar: Record<Tone, string> = {
  sleep:    "var(--color-sleep)",
  heart:    "var(--color-heart)",
  activity: "var(--color-activity)",
  stress:   "var(--color-stress)",
  body:     "var(--color-temp)",
};

export function MetricTimelinePanel({
  data,
  baseline,
  tone,
  unit,
}: {
  data: MetricDetail["timeline_30d"];
  baseline: MetricDetail["timeline_baseline"];
  tone: Tone;
  unit?: string;
}) {
  const color = toneVar[tone];
  const points = data.filter((p): p is { date: string; value: number } => p.value != null);
  if (points.length < 2) {
    return <Empty label="Zu wenig Daten für 30-Tage-Verlauf" />;
  }

  const bandTop = baseline.mean != null && baseline.std != null ? baseline.mean + baseline.std : null;
  const bandBot = baseline.mean != null && baseline.std != null ? baseline.mean - baseline.std : null;

  return (
    <div className="w-full h-[180px] sm:h-[200px] md:h-[220px]">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="metric-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.4" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtMd}
            stroke="var(--color-text-faint)"
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            stroke="var(--color-text-faint)"
            width={36}
          />
          {bandTop != null && bandBot != null && (
            <ReferenceArea y1={bandBot} y2={bandTop} fill={color} fillOpacity={0.08} />
          )}
          {baseline.mean != null && (
            <ReferenceLine y={baseline.mean} stroke={color} strokeDasharray="3 3" strokeOpacity={0.6} />
          )}
          <Tooltip
            cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { date: string; value: number | null };
              if (p.value == null) return null;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                  <div className="num-mono text-[var(--color-text)]">{p.value.toFixed(2)} {unit ?? ""}</div>
                  <div className="text-subtle">{fmtMdY(p.date)}</div>
                </div>
              );
            }}
          />
          <Area
            dataKey="value"
            type="monotone"
            stroke={color}
            strokeWidth={1.75}
            fill="url(#metric-fill)"
            connectNulls
            isAnimationActive
            animationDuration={500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MetricHistogramPanel({
  bins,
  todayValue,
  tone,
}: {
  bins: DistributionBin[];
  todayValue: number | null;
  tone: Tone;
}) {
  const color = toneVar[tone];
  if (bins.length === 0) return <Empty label="Noch keine Verteilung" />;
  const todayIdx = todayValue == null
    ? -1
    : bins.findIndex((bin, i) => {
        const [a, b] = bin.range;
        const last = i === bins.length - 1;
        return last ? todayValue >= a && todayValue <= b : todayValue >= a && todayValue < b;
      });
  return (
    <div className="w-full h-[150px] sm:h-[170px] md:h-[180px]">
      <ResponsiveContainer>
        <BarChart data={bins} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucket"
            stroke="var(--color-text-faint)"
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            stroke="var(--color-text-faint)"
            width={28}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)", fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as DistributionBin;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)]">
                  <div className="num-mono">{p.bucket}</div>
                  <div className="text-subtle">{p.count} Tage</div>
                </div>
              );
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={400}>
            {bins.map((_, i) => (
              <Cell key={i} fill={color} fillOpacity={i === todayIdx ? 0.95 : 0.5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MetricWeekOverlayPanel({
  days,
  tone,
}: {
  days: WeekOverlayDay[];
  tone: Tone;
}) {
  const color = toneVar[tone];
  const flat = days.filter((d) => d.series.length > 0);
  if (flat.length === 0) return <Empty label="Wochen-Overlay nicht verfügbar" />;
  // Stack series side-by-side: build merged frame keyed by x.
  const allX = Array.from(new Set(flat.flatMap((d) => d.series.map((p) => Number(p.x))))).sort((a, b) => a - b);
  const merged = allX.map((x) => {
    const row: Record<string, number | null | string> = { x };
    for (const d of flat) {
      const pt = d.series.find((p) => Number(p.x) === x);
      row[d.date] = pt?.value ?? null;
    }
    return row;
  });
  const todayKey = flat[flat.length - 1].date;
  return (
    <div className="w-full h-[150px] sm:h-[170px] md:h-[180px]">
      <ResponsiveContainer>
        <LineChart data={merged} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="x" stroke="var(--color-text-faint)" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} stroke="var(--color-text-faint)" width={36} />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)] flex flex-col gap-0.5">
                  {payload
                    .filter((p) => p.value != null)
                    .map((p) => (
                      <div key={p.dataKey as string} className="flex justify-between gap-3">
                        <span className={p.dataKey === todayKey ? "text-[var(--color-text)]" : "text-subtle"}>
                          {fmtMd(p.dataKey as string)}
                        </span>
                        <span className="num-mono">{(p.value as number).toFixed(2)}</span>
                      </div>
                    ))}
                </div>
              );
            }}
          />
          {flat.map((d, i) => {
            const isToday = d.date === todayKey;
            return (
              <Line
                key={d.date}
                dataKey={d.date}
                type="monotone"
                stroke={color}
                strokeWidth={isToday ? 2 : 1}
                strokeOpacity={isToday ? 1 : 0.25 + (i / flat.length) * 0.3}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MetricSamplesPanel({
  samples,
  unit = "",
  decimals = 1,
}: {
  samples: SampleRow[];
  unit?: string;
  decimals?: number;
}) {
  if (samples.length === 0) return <Empty label="Keine Samples für diesen Tag" />;
  return (
    <div className="max-h-[60vh] md:max-h-[400px] overflow-y-auto rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
      {samples.map((s, i) => (
        <div key={i} className="flex items-center justify-between px-3 py-2 text-caption">
          <span className="num-mono text-subtle">{fmtHm(s.ts_iso)}</span>
          <span className="num-mono">{s.value.toFixed(decimals)}{unit ? ` ${unit}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div
      className="grid place-items-center text-caption rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/30 h-[150px] sm:h-[170px] md:h-[180px]"
    >
      {label}
    </div>
  );
}

function fmtMd(date: string): string {
  if (!date || date.length < 10) return date;
  const [, m, d] = date.split("-");
  return `${Number(d)}.${Number(m)}.`;
}
function fmtMdY(date: string): string {
  if (!date || date.length < 10) return date;
  const [, m, d] = date.split("-");
  return `${Number(d)}.${Number(m)}.`;
}
function fmtHm(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });
}
