import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unstable_noStore as noStore } from "next/cache";

import { sleepWindowForDate, addDays } from "@/lib/time";
import { getSleepStages, getSleepStats, getStageDurations, getApneaEvents } from "@/lib/queries/sleep";
import type { FactsBundleV2 } from "@/lib/types/generated";
import { fmtInt } from "@/lib/format";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { InsightSection } from "@/components/domain/insight-section";
import { loadSleepInsight } from "@/lib/v3-loaders";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Hypnogram } from "@/components/charts/hypnogram";
import { StageDonut } from "@/components/charts/stage-donut";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import { FadeRise } from "@/components/motion/fade-rise";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

export default async function SleepDetail({ params }: { params: Promise<{ date: string }> }) {
  noStore();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const sw = sleepWindowForDate(date);
  const dates14 = Array.from({ length: 14 }, (_, i) => addDays(date, -(13 - i)));

  const [stats, stages, stageDurs, apnea, facts14, sleepInsight] = await Promise.all([
    Promise.resolve(getSleepStats(sw)),
    Promise.resolve(getSleepStages(sw)),
    Promise.resolve(getStageDurations(sw)),
    Promise.resolve(getApneaEvents(sw)),
    Promise.all(dates14.map(loadFacts)),
    loadSleepInsight(date),
  ]);

  const tstSeries = facts14.map((f) => f?.sleep?.metrics?.tst_min ?? null);
  const effSeries = facts14.map((f) => f?.sleep?.metrics?.sleep_efficiency_pct ?? null);
  const remSeries = facts14.map((f) => f?.sleep?.metrics?.rem_min ?? null);
  const deepSeries = facts14.map((f) => f?.sleep?.metrics?.deep_min ?? null);
  const today = facts14[13]?.sleep?.metrics ?? null;

  const stripItems = dates14.map((d, i) => ({
    date: d,
    band: bandFor(facts14[i]?.sleep?.metrics?.sleep_efficiency_pct ?? null),
    score: facts14[i]?.sleep?.metrics?.sleep_efficiency_pct ?? null,
  }));

  const totalSleep = stageDurs[1] + stageDurs[2] + stageDurs[3];

  return (
    <div className="flex flex-col gap-6">
      <DomainChrome
        domainLabel="Schlaf"
        date={date}
        hrefBase="/sleep"
        icon="Moon"
      />

      <div className="hidden md:flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/sleep/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">Effizienz</span>
      </div>

      <FadeRise>
        <InsightSection insight={sleepInsight} domainLabel="Schlaf" />
      </FadeRise>

      <FadeRise>
        <Card glow="sleep">
          <CardBody className="p-5 lg:p-6 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-center">
            <StageDonut durations={stageDurs} size={180} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Gesamt"   value={fmtH(totalSleep)} />
              <Stat label="Tief"     value={fmtH(stageDurs[3])} />
              <Stat label="REM"      value={fmtH(stageDurs[2])} />
              <Stat label="Wach"     value={fmtH(stageDurs[4])} />
              {stats && (
                <>
                  <Stat label="Effizienz" value={`${stats.efficiency}`} unit="%" />
                  <Stat label="Latenz"    value={fmtH(stats.latencyMin)} />
                  <Stat label="HRV"       value={fmtInt(stats.avgHrv)} unit="ms" />
                  <Stat label="Atem"      value={(stats.avgBreathRate || 0).toFixed(1)} unit="bpm" />
                </>
              )}
            </div>
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="Phasen" title="Hypnogramm">
        <Card>
          <CardBody className="p-5">
            <Hypnogram blocks={stages} windowStart={sw.since * 1000} windowEnd={sw.until * 1000} height={200} />
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Nachts" title="Atemwege & Schlaf-Puls">
        <Card variant="soft">
          <CardBody className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Ruhepuls Schlaf" value={today?.rhr_sleep_bpm != null ? Math.round(today.rhr_sleep_bpm) : "—"} unit="bpm" />
            <Stat label="HR min/max"      value={today?.hr_min_sleep != null && today?.hr_max_sleep != null ? `${Math.round(today.hr_min_sleep)}–${Math.round(today.hr_max_sleep)}` : "—"} unit="bpm" />
            <Stat label="SpO₂ min"        value={today?.spo2_min_pct != null ? Math.round(today.spo2_min_pct) : "—"} unit="%" />
            <Stat label="Atem"            value={today?.breath_rate_mean != null ? today.breath_rate_mean.toFixed(1) : "—"} unit="/min" />
            <Stat label="Aufwacher"       value={today?.wake_count != null ? today.wake_count : "—"} />
            <Stat label="RDI"             value={today?.rdi != null ? today.rdi.toFixed(1) : "—"} />
            <Stat label="Apnoe-Index"     value={today?.apnea_max_level != null ? today.apnea_max_level : "—"} />
            <Stat label="Apnoe-Ereignisse" value={today?.apnea_events_count != null ? today.apnea_events_count : "—"} />
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Trend" title="14 Tage">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TrendTile label="Gesamtschlaf" series={tstSeries} unit="min" duration tone="sleep" />
          <TrendTile label="Effizienz"   series={effSeries} unit="%"   tone="sleep" />
          <TrendTile label="REM"          series={remSeries} unit="min" duration tone="sleep" />
          <TrendTile label="Tief"         series={deepSeries} unit="min" duration tone="sleep" />
        </div>
        {/* Compact band strip lives at the top of the page now; bottom
           variant kept for mobile where the top strip is hidden. */}
        <Card variant="soft" className="mt-3 md:hidden">
          <CardBody className="p-5 overflow-x-auto">
            <BandStrip items={stripItems} hrefBase="/sleep/" active={date} />
          </CardBody>
        </Card>
      </Section>

      {apnea.length > 0 && (
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
      )}
    </div>
  );
}

function TrendTile({
  label, series, unit, tone, duration = false,
}: {
  label: string;
  series: (number | null)[];
  unit?: string;
  tone: "sleep";
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
    const m = Math.round(abs % 60);
    return m === 0 ? `${h}h` : `${h}:${String(m).padStart(2, "0")}`;
  };
  return (
    <Card>
      <CardBody className="p-4 flex flex-col gap-2 min-h-[110px]">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow !text-[10px]">{label}</span>
          {delta != null && (
            <span className={`num-mono text-[0.6875rem] ${delta > 0 ? "text-[var(--color-band-up)]" : delta < 0 ? "text-[var(--color-band-down)]" : "text-subtle"}`}>
              {delta > 0 ? "+" : delta < 0 ? "−" : ""}{fmtDelta(delta)}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="num text-[1.375rem] font-semibold leading-none">{last != null ? fmtMain(last) : "—"}</span>
          {showUnit && last != null && <span className="text-subtle text-[0.6875rem] num-mono">{unit}</span>}
        </div>
        <Sparkline values={clean.slice(-10)} tone={tone} width={160} height={28} className="mt-auto" />
      </CardBody>
    </Card>
  );
}

async function loadFacts(date: string): Promise<FactsBundleV2 | null> {
  const p = path.join(INSIGHTS_ROOT, "daily", date, "_facts.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
}

function bandFor(eff: number | null): "above_usual" | "below_usual" | "steady" | null {
  if (eff == null) return null;
  if (eff >= 85) return "above_usual";
  if (eff < 75) return "below_usual";
  return "steady";
}

function fmtH(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
