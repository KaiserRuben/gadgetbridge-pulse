import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { sleepWindowForDate } from "@/lib/time";
import { getSleepStages, getStageDurations, getApneaEvents } from "@/lib/queries/sleep";
import { readViewState } from "@/lib/view-state/fetcher";
import { detailToday, detailSeries, detailDates } from "@/lib/view-state/detail";
import type { ViewStateDaily } from "@/runner/v4/types.ts";
import { fmtInt } from "@/lib/format";

import { DomainDetailHeader } from "@/components/view/DomainDetailHeader";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Hypnogram } from "@/components/charts/hypnogram";
import { StageDonut } from "@/components/charts/stage-donut";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

export default async function SleepDetail({ params }: { params: Promise<{ date: string }> }) {
  noStore();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const sw = sleepWindowForDate(date);

  // Raw telemetry (hypnogram shape, stage durations, apnea events) stays a
  // direct DB read — per-minute sensor data that does not belong in the synced
  // view doc. Everything derived comes from the view-state tier1.detail block.
  const [stages, stageDurs, apnea, view] = await Promise.all([
    Promise.resolve(getSleepStages(sw)),
    Promise.resolve(getStageDurations(sw)),
    Promise.resolve(getApneaEvents(sw)),
    readViewState(date) as Promise<ViewStateDaily | null>,
  ]);

  const m = (id: string) => detailToday(view, `sleep.${id}`);
  const tst = m("tst_min");
  const eff = m("sleep_efficiency_pct");
  const score = m("sleep_score");
  const effSeries = detailSeries(view, "sleep.sleep_efficiency_pct");
  const scoreSeries = detailSeries(view, "sleep.sleep_score");
  const dates14 = detailDates(view, "sleep.sleep_efficiency_pct");

  const stripItems = dates14.map((d, i) => ({
    date: d,
    band: bandFor(effSeries[i]),
    score: effSeries[i],
  }));

  const totalSleep = stageDurs[1] + stageDurs[2] + stageDurs[3];

  const support = [
    eff != null ? `Effizienz ${Math.round(eff)}%` : null,
    score != null ? `Score ${Math.round(score)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <DomainDetailHeader
        domainLabel="Schlaf"
        date={date}
        hrefBase="/sleep"
        tone="sleep"
        hero={{ value: tst ?? totalSleep, fmt: "hm", label: "Gesamtschlaf" }}
        support={support || null}
        trend={{ series: scoreSeries, label: "Schlaf-Score" }}
      />

      <div className="hidden items-center justify-between gap-3 md:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/sleep/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">Effizienz</span>
      </div>

      <Stagger className="flex flex-col gap-6">
        <StaggerItem>
          <Card glow="sleep">
            <CardBody className="grid grid-cols-1 items-center gap-6 p-5 lg:grid-cols-[auto_1fr] lg:p-6">
              <StageDonut durations={stageDurs} size={180} />
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Gesamt" value={fmtH(totalSleep)} />
                <Stat label="Tief" value={fmtH(stageDurs[3])} />
                <Stat label="REM" value={fmtH(stageDurs[2])} />
                <Stat label="Wach" value={fmtH(stageDurs[4])} />
                <Stat label="Effizienz" value={fmtNum(eff)} unit="%" />
                <Stat label="Latenz" value={fmtMinH(m("sleep_latency_min"))} />
                <Stat label="HRV" value={fmtNum(m("rmssd_ms"), fmtInt)} unit="ms" />
                <Stat label="Atem" value={fmtNum(m("breath_rate_mean"), (v) => v.toFixed(1))} unit="bpm" />
              </div>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Phasen" title="Hypnogramm">
            <Card>
              <CardBody className="p-5">
                <Hypnogram blocks={stages} windowStart={sw.since * 1000} windowEnd={sw.until * 1000} height={200} />
              </CardBody>
            </Card>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Nachts" title="Atemwege & Schlaf-Puls">
            <Card variant="soft">
              <CardBody className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4">
                <Stat label="Ruhepuls Schlaf" value={fmtNum(m("rhr_sleep_bpm"), Math.round)} unit="bpm" />
                <Stat
                  label="HR min/max"
                  value={
                    m("hr_min_sleep") != null && m("hr_max_sleep") != null
                      ? `${Math.round(m("hr_min_sleep")!)}–${Math.round(m("hr_max_sleep")!)}`
                      : "—"
                  }
                  unit="bpm"
                />
                <Stat label="SpO₂ min" value={fmtNum(m("spo2_min_pct"), Math.round)} unit="%" />
                <Stat label="Atem" value={fmtNum(m("breath_rate_mean"), (v) => v.toFixed(1))} unit="/min" />
                <Stat label="Aufwacher" value={fmtNum(m("wake_count"))} />
                <Stat label="RDI" value={fmtNum(m("rdi"), (v) => v.toFixed(1))} />
                <Stat label="Apnoe-Index" value={fmtNum(m("apnea_max_level"))} />
                <Stat label="Apnoe-Ereignisse" value={fmtNum(m("apnea_events_count"))} />
              </CardBody>
            </Card>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Trend" title="14 Tage">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <TrendTile label="Gesamtschlaf" series={detailSeries(view, "sleep.tst_min")} duration />
              <TrendTile label="Effizienz" series={effSeries} unit="%" />
              <TrendTile label="REM" series={detailSeries(view, "sleep.rem_min")} duration />
              <TrendTile label="Tief" series={detailSeries(view, "sleep.deep_min")} duration />
            </div>
            <Card variant="soft" className="mt-3 md:hidden">
              <CardBody className="overflow-x-auto p-5">
                <BandStrip items={stripItems} hrefBase="/sleep/" active={date} />
              </CardBody>
            </Card>
          </Section>
        </StaggerItem>

        {apnea.length > 0 && (
          <StaggerItem>
            <Section eyebrow="Apnoe" title={`${apnea.length} Ereignisse`}>
              <Card>
                <CardBody className="p-5">
                  <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                    {apnea.slice(0, 8).map((a, i) => (
                      <li key={i} className="flex items-center justify-between py-2 text-[0.875rem]">
                        <span className="num-mono text-subtle">
                          {new Date(a.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}
                        </span>
                        <span>{a.durationSec}s</span>
                        <span className="text-caption">Level {a.level}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </Section>
          </StaggerItem>
        )}
      </Stagger>
    </div>
  );
}

function TrendTile({
  label,
  series,
  unit,
  duration = false,
}: {
  label: string;
  series: Array<number | null>;
  unit?: string;
  /** Series values are minutes — render as h:mm and skip the raw unit suffix. */
  duration?: boolean;
}) {
  const clean = series.filter((v): v is number => v != null);
  const last = clean[clean.length - 1];
  const prev = clean[clean.length - 2];
  const delta = last != null && prev != null ? last - prev : null;
  const showUnit = unit && !duration;
  const fmtMain = (v: number) => (duration ? fmtH(v) : Math.round(v).toString());
  const fmtDelta = (v: number) => {
    if (!duration) return `${Math.abs(Math.round(v))}${unit ?? ""}`;
    const abs = Math.abs(v);
    if (abs < 60) return `${Math.round(abs)}m`;
    const h = Math.floor(abs / 60);
    const mm = Math.round(abs % 60);
    return mm === 0 ? `${h}h` : `${h}:${String(mm).padStart(2, "0")}`;
  };
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
              {fmtDelta(delta)}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="num text-[1.375rem] font-semibold leading-none">{last != null ? fmtMain(last) : "—"}</span>
          {showUnit && last != null && <span className="text-subtle num-mono text-[0.6875rem]">{unit}</span>}
        </div>
        <Sparkline values={series.slice(-10)} tone="sleep" width={160} height={28} markers className="mt-auto" />
      </CardBody>
    </Card>
  );
}

function bandFor(eff: number | null): "above_usual" | "below_usual" | "steady" | null {
  if (eff == null) return null;
  if (eff >= 85) return "above_usual";
  if (eff < 75) return "below_usual";
  return "steady";
}

function fmtNum(v: number | null, fmt: (n: number) => string | number = (n) => n): string {
  if (v == null) return "—";
  return String(fmt(v));
}

function fmtH(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const mm = Math.round(min % 60);
  return `${h}:${String(mm).padStart(2, "0")}`;
}

function fmtMinH(v: number | null): string {
  return v == null ? "—" : fmtH(v);
}
