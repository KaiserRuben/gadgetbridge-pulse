import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unstable_noStore as noStore } from "next/cache";

import { addDays, windowForDate } from "@/lib/time";
import { getActivityMinutes, getDaySummary } from "@/lib/queries/activity";
import { loadMorningInsight, type MorningLeverCard } from "@/lib/v3-loaders";
import type { FactsBundleV2 } from "@/lib/types/generated";
import { fmtInt } from "@/lib/format";
import { HR_ZONES, hrZone } from "@/lib/constants";
import { parseTimestampParam } from "@/lib/alarm-target";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { ExplainSpikeButton } from "@/components/domain/explain-spike-button";
import { InsightSection } from "@/components/domain/insight-section";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Timeline, type TimelinePoint } from "@/components/charts/timeline";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import { FadeRise } from "@/components/motion/fade-rise";
import { leverToInsight } from "@/lib/dashboard/lever-to-insight";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

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
  const dates14 = Array.from({ length: 14 }, (_, i) => addDays(date, -(13 - i)));

  const [mins, summary, facts14, morning] = await Promise.all([
    Promise.resolve(getActivityMinutes(w)),
    Promise.resolve(getDaySummary(w)),
    Promise.all(dates14.map(loadFacts)),
    loadMorningInsight(date),
  ]);

  // Heart page reuses the shared `<InsightSection>` — there is no
  // `heart_insight` cluster yet, so we hand-pick the best morning-briefing
  // lever (heart / cardio) and shim it into the AnyInsight shape. When no
  // cardio lever was emitted we pass null and InsightSection's "Noch keine
  // Analyse" stub takes over.
  const heartLever = pickBestHeartLever(morning?.levers ?? []);
  const heartInsight = leverToInsight(heartLever, { kpiId: "heart_lever" });

  const hr: TimelinePoint[] = mins
    .filter((m) => m.hr > 30 && m.hr < 220)
    .map((m) => ({ ts: m.ts * 1000, v: m.hr }));

  const zoneMin: Record<string, number> = Object.fromEntries(HR_ZONES.map((z) => [z.label, 0]));
  for (const m of mins) {
    if (m.hr > 30 && m.hr < 220) zoneMin[hrZone(m.hr).label] += 1;
  }

  const rhrSeries = facts14.map((f) => f?.cardio?.metrics?.rhr_day_bpm ?? null).filter((v): v is number => v != null);
  const hrMaxSeries = facts14.map((f) => f?.cardio?.metrics?.hr_max_bpm ?? null).filter((v): v is number => v != null);
  const hrvSeries = facts14
    .map((f) => {
      const arr = f?.cardio?.hrv_series ?? null;
      if (!arr || arr.length === 0) return null;
      return arr.reduce((s, x) => s + x.value_ms, 0) / arr.length;
    })
    .filter((v): v is number => v != null);
  const spoSeries = facts14.map((f) => f?.cardio?.metrics?.spo2_mean_pct ?? null).filter((v): v is number => v != null);

  const stripItems = dates14.map((d, i) => {
    const rhr = facts14[i]?.cardio?.metrics?.rhr_day_bpm ?? null;
    return {
      date: d,
      band: rhrBand(rhr),
      score: rhr,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <DomainChrome
        domainLabel="Herz"
        date={date}
        hrefBase="/heart"
        icon="HeartPulse"
      />

      <div className="hidden md:flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/heart/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">Ruhepuls</span>
      </div>

      <FadeRise>
        <Card glow="heart">
          <CardBody className="p-5 lg:p-6 flex flex-col gap-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Ruhepuls" value={fmtInt(facts14[13]?.cardio?.metrics?.rhr_day_bpm ?? 0)} unit="bpm" />
              <Stat label="Mittel"   value={fmtInt(summary.hrAvg || 0)} unit="bpm" />
              <Stat label="Maximum"  value={fmtInt(summary.hrMax || 0)} unit="bpm" />
              <Stat label="Minimum"  value={fmtInt(summary.hrMin || 0)} unit="bpm" />
            </div>
            <div className="pt-4 border-t border-[var(--color-border)] grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="SpO₂ ⌀" value={facts14[13]?.cardio?.metrics?.spo2_mean_pct != null ? facts14[13]!.cardio.metrics.spo2_mean_pct!.toFixed(1) : "—"} unit="%" />
              <Stat label="HRV"    value={fmtInt(today14HrvAvg(facts14[13]) ?? 0)} unit="ms" />
              <Stat label="RHR Schlaf" value={facts14[13]?.sleep?.metrics?.rhr_sleep_bpm != null ? Math.round(facts14[13]!.sleep!.metrics!.rhr_sleep_bpm!) : "—"} unit="bpm" />
              <Stat label="Atem"   value={facts14[13]?.sleep?.metrics?.breath_rate_mean != null ? facts14[13]!.sleep!.metrics!.breath_rate_mean!.toFixed(1) : "—"} unit="/min" />
            </div>
          </CardBody>
        </Card>
      </FadeRise>

      <FadeRise>
        <InsightSection insight={heartInsight} domainLabel="Herz" />
      </FadeRise>

      <Section eyebrow="24 h" title="Verlauf">
        <Card>
          <CardBody className="p-5 flex flex-col gap-3">
            {highlightTs != null && (
              <div className="flex flex-col gap-3 px-3 py-3 rounded-lg bg-[var(--color-heart)]/10 border border-[var(--color-heart)]/30">
                <div className="flex items-center gap-2 text-caption">
                  <span className="size-2 rounded-full bg-[var(--color-heart)]" />
                  <span className="text-[var(--color-text)]">
                    Signal um <span className="num-mono">{fmtHm(highlightTs)}</span> markiert
                  </span>
                </div>
                <ExplainSpikeButton ts={highlightTs} metric="hr" date={date} />
              </div>
            )}
            <Timeline data={hr} tone="heart" unit="bpm" height={260} brush
              bands={HR_ZONES.map((z) => ({ from: z.min, to: z.max, color: z.color }))}
              highlightTs={highlightTs}
            />
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Zonen" title="Verteilung">
        <Card variant="soft">
          <CardBody className="p-5 flex flex-col gap-2">
            {HR_ZONES.map((z) => {
              const total = Object.values(zoneMin).reduce((s, v) => s + v, 0) || 1;
              const pct = (zoneMin[z.label] / total) * 100;
              return (
                <div key={z.label} className="flex items-center gap-2 sm:gap-3">
                  <span className="w-16 sm:w-[88px] text-[0.75rem] sm:text-[0.875rem] truncate">{z.label}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden bg-[var(--color-bg-elevated)]">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: z.color }} />
                  </div>
                  <span className="num-mono text-caption w-12 sm:w-[60px] text-right shrink-0">{fmtInt(zoneMin[z.label])}m</span>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Trend" title="14 Tage">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TrendTile label="Ruhepuls"  series={rhrSeries} unit="bpm" tone="heart" />
          <TrendTile label="HR max"    series={hrMaxSeries} unit="bpm" tone="heart" />
          <TrendTile label="HRV"       series={hrvSeries} unit="ms"  tone="heart" />
          <TrendTile label="SpO₂"      series={spoSeries} unit="%"   tone="heart" />
        </div>
      </Section>
    </div>
  );
}

/**
 * Rank morning-briefing levers and pick the strongest cardio one. Lever
 * "domain" comes from runner-side classification — both "heart" and the
 * legacy "cardio" label are accepted.
 */
function pickBestHeartLever(cards: MorningLeverCard[]): MorningLeverCard | null {
  if (cards.length === 0) return null;
  const cardio = cards.filter(
    (c) => c.domain === "heart" || c.domain === "cardio",
  );
  if (cardio.length === 0) return null;
  const rank = (c: MorningLeverCard): number =>
    c.confidence === "high" ? 2 : c.confidence === "medium" ? 1 : 0;
  return [...cardio].sort((a, b) => rank(b) - rank(a))[0];
}

function TrendTile({
  label, series, unit, tone,
}: {
  label: string;
  series: number[];
  unit?: string;
  tone: "heart";
}) {
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = last != null && prev != null ? last - prev : null;
  return (
    <Card>
      <CardBody className="p-4 flex flex-col gap-2 min-h-[110px]">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow !text-[10px]">{label}</span>
          {delta != null && (
            <span className={`num-mono text-[0.6875rem] ${delta > 0 ? "text-[var(--color-band-up)]" : delta < 0 ? "text-[var(--color-band-down)]" : "text-subtle"}`}>
              {delta > 0 ? "+" : delta < 0 ? "−" : ""}{Math.abs(Math.round(delta))}{unit}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="num text-[1.375rem] font-semibold leading-none">{last != null ? Math.round(last) : "—"}</span>
          {unit && last != null && <span className="text-subtle text-[0.6875rem] num-mono">{unit}</span>}
        </div>
        <Sparkline values={series.slice(-10)} tone={tone} width={160} height={28} className="mt-auto" />
      </CardBody>
    </Card>
  );
}

function today14HrvAvg(f: FactsBundleV2 | null): number | null {
  const arr = f?.cardio?.hrv_series ?? null;
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, x) => s + x.value_ms, 0) / arr.length;
}

function fmtHm(ts: number): string {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });
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

function rhrBand(rhr: number | null): "above_usual" | "below_usual" | "steady" | null {
  if (rhr == null) return null;
  if (rhr < 60) return "above_usual";
  if (rhr > 70) return "below_usual";
  return "steady";
}
