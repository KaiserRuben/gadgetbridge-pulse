import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { windowForDate } from "@/lib/time";
import { getActivityMinutes, getDaySummary } from "@/lib/queries/activity";
import { fmtInt } from "@/lib/format";
import { HR_ZONES, hrZone } from "@/lib/constants";
import { parseTimestampParam } from "@/lib/alarm-target";
import { readViewState } from "@/lib/view-state/fetcher";
import { detailToday, detailSeries, detailDates } from "@/lib/view-state/detail";
import type { ViewStateDaily } from "@/runner/v4/types.ts";

import { DomainDetailHeader } from "@/components/view/DomainDetailHeader";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Timeline, type TimelinePoint } from "@/components/charts/timeline";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

export default async function HeartDetail({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams?: Promise<{ t?: string }>;
}) {
  noStore();
  const { date } = await params;
  const sp = (await searchParams) ?? {};
  const highlightTs = parseTimestampParam(sp.t);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const w = windowForDate(date);
  // HR curve + zone minutes stay a direct DB read (per-minute telemetry);
  // derived scalars + trends come from view-state tier1.detail.
  const [mins, summary, view] = await Promise.all([
    Promise.resolve(getActivityMinutes(w)),
    Promise.resolve(getDaySummary(w)),
    readViewState(date) as Promise<ViewStateDaily | null>,
  ]);

  const hr: TimelinePoint[] = mins
    .filter((m) => m.hr > 30 && m.hr < 220)
    .map((m) => ({ ts: m.ts * 1000, v: m.hr }));

  const zoneMin: Record<string, number> = Object.fromEntries(HR_ZONES.map((z) => [z.label, 0]));
  for (const m of mins) {
    if (m.hr > 30 && m.hr < 220) zoneMin[hrZone(m.hr).label] += 1;
  }

  const rhrSeries = detailSeries(view, "cardio.rhr_day_bpm");
  const hrMaxSeries = detailSeries(view, "cardio.hr_max_bpm");
  const hrvSeries = detailSeries(view, "sleep.rmssd_ms");
  const spoSeries = detailSeries(view, "cardio.spo2_mean_pct");
  const dates14 = detailDates(view, "cardio.rhr_day_bpm");

  const stripItems = dates14.map((d, i) => ({
    date: d,
    band: rhrBand(rhrSeries[i]),
    score: rhrSeries[i],
  }));

  const support = summary.hrAvg
    ? `Mittel ${Math.round(summary.hrAvg)} · Max ${Math.round(summary.hrMax)} bpm`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <DomainDetailHeader
        domainLabel="Herz"
        date={date}
        hrefBase="/heart"
        tone="heart"
        hero={{ value: detailToday(view, "cardio.rhr_day_bpm"), fmt: "int", unit: "bpm", label: "Ruhepuls" }}
        support={support}
        trend={{ series: rhrSeries, label: "Ruhepuls" }}
      />

      <div className="hidden items-center justify-between gap-3 md:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/heart/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">Ruhepuls</span>
      </div>

      <Stagger className="flex flex-col gap-6">
        <StaggerItem>
          <Card glow="heart">
            <CardBody className="flex flex-col gap-5 p-5 lg:p-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Ruhepuls" value={fmtNum(detailToday(view, "cardio.rhr_day_bpm"), Math.round)} unit="bpm" />
                <Stat label="Mittel" value={fmtInt(summary.hrAvg || 0)} unit="bpm" />
                <Stat label="Maximum" value={fmtInt(summary.hrMax || 0)} unit="bpm" />
                <Stat label="Minimum" value={fmtInt(summary.hrMin || 0)} unit="bpm" />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 lg:grid-cols-4">
                <Stat label="SpO₂ ⌀" value={fmtNum(detailToday(view, "cardio.spo2_mean_pct"), (v) => v.toFixed(1))} unit="%" />
                <Stat label="HRV" value={fmtNum(detailToday(view, "sleep.rmssd_ms"), Math.round)} unit="ms" />
                <Stat label="RHR Schlaf" value={fmtNum(detailToday(view, "sleep.rhr_sleep_bpm"), Math.round)} unit="bpm" />
                <Stat label="Atem" value={fmtNum(detailToday(view, "sleep.breath_rate_mean"), (v) => v.toFixed(1))} unit="/min" />
              </div>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="24 h" title="Verlauf">
            <Card>
              <CardBody className="flex flex-col gap-3 p-5">
                {highlightTs != null && (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--color-heart)]/30 bg-[var(--color-heart)]/10 px-3 py-2 text-caption">
                    <span className="size-2 rounded-full bg-[var(--color-heart)]" />
                    <span className="text-[var(--color-text)]">
                      Signal um <span className="num-mono">{fmtHm(highlightTs)}</span> markiert
                    </span>
                  </div>
                )}
                <Timeline
                  data={hr}
                  tone="heart"
                  unit="bpm"
                  height={260}
                  brush
                  bands={HR_ZONES.map((z) => ({ from: z.min, to: z.max, color: z.color }))}
                  highlightTs={highlightTs}
                />
              </CardBody>
            </Card>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Zonen" title="Verteilung">
            <Card variant="soft">
              <CardBody className="flex flex-col gap-2 p-5">
                {HR_ZONES.map((z) => {
                  const total = Object.values(zoneMin).reduce((s, v) => s + v, 0) || 1;
                  const pct = (zoneMin[z.label] / total) * 100;
                  return (
                    <div key={z.label} className="flex items-center gap-2 sm:gap-3">
                      <span className="w-16 truncate text-[0.75rem] sm:w-[88px] sm:text-[0.875rem]">{z.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: z.color }} />
                      </div>
                      <span className="num-mono text-caption w-12 shrink-0 text-right sm:w-[60px]">{fmtInt(zoneMin[z.label])}m</span>
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Trend" title="14 Tage">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <TrendTile label="Ruhepuls" series={rhrSeries} unit="bpm" />
              <TrendTile label="HR max" series={hrMaxSeries} unit="bpm" />
              <TrendTile label="HRV" series={hrvSeries} unit="ms" />
              <TrendTile label="SpO₂" series={spoSeries} unit="%" />
            </div>
          </Section>
        </StaggerItem>
      </Stagger>
    </div>
  );
}

function TrendTile({
  label,
  series,
  unit,
}: {
  label: string;
  series: Array<number | null>;
  unit?: string;
}) {
  const clean = series.filter((v): v is number => v != null);
  const last = clean[clean.length - 1];
  const prev = clean[clean.length - 2];
  const delta = last != null && prev != null ? last - prev : null;
  return (
    <Card>
      <CardBody className="flex min-h-[110px] flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow !text-[10px]">{label}</span>
          {delta != null && (
            <span
              className={`num-mono text-[0.6875rem] ${delta > 0 ? "text-[var(--color-band-up)]" : delta < 0 ? "text-[var(--color-band-down)]" : "text-subtle"}`}
            >
              {delta > 0 ? "+" : delta < 0 ? "−" : ""}
              {Math.abs(Math.round(delta))}
              {unit}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="num text-[1.375rem] font-semibold leading-none">{last != null ? Math.round(last) : "—"}</span>
          {unit && last != null && <span className="text-subtle num-mono text-[0.6875rem]">{unit}</span>}
        </div>
        <Sparkline values={series.slice(-10)} tone="heart" width={160} height={28} markers className="mt-auto" />
      </CardBody>
    </Card>
  );
}

function rhrBand(rhr: number | null): "above_usual" | "below_usual" | "steady" | null {
  if (rhr == null) return null;
  if (rhr < 60) return "above_usual";
  if (rhr > 70) return "below_usual";
  return "steady";
}

function fmtHm(ts: number): string {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function fmtNum(v: number | null, fmt: (n: number) => string | number = (n) => n): string {
  if (v == null) return "—";
  return String(fmt(v));
}
