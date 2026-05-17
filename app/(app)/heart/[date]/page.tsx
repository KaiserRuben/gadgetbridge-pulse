import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unstable_noStore as noStore } from "next/cache";

import { addDays, windowForDate } from "@/lib/time";
import { getActivityMinutes, getDaySummary } from "@/lib/queries/activity";
import { loadDaily, loadDailyStatus, type DailyStatus } from "@/lib/insights";
import { loadMorningInsight, type MorningLeverCard } from "@/lib/v3-loaders";
import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";
import { fmtInt } from "@/lib/format";
import { HR_ZONES, hrZone } from "@/lib/constants";
import { parseTimestampParam } from "@/lib/alarm-target";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { ExplainSpikeButton } from "@/components/domain/explain-spike-button";
import { CoachTakeaway } from "@/components/coach/coach-takeaway";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { Timeline, type TimelinePoint } from "@/components/charts/timeline";
import { Sparkline } from "@/components/charts/sparkline";
import { FadeRise } from "@/components/motion/fade-rise";

// Coach cards moved to `morning_insight.levers`; the daily.coaching_cards
// shape was effectively the same so the heart filter just reuses the new
// MorningLeverCard type.
type DailyDriver = DailyInsightV2["drivers"][number];

const HEART_TERM_RE = /\b(rhr|hrv|puls|herz|bpm)\b/i;

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

  const [mins, summary, facts14, daily, dailyStatus, morning] = await Promise.all([
    Promise.resolve(getActivityMinutes(w)),
    Promise.resolve(getDaySummary(w)),
    Promise.all(dates14.map(loadFacts)),
    loadDaily(date),
    loadDailyStatus(date),
    loadMorningInsight(date),
  ]);

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

  return (
    <div className="flex flex-col gap-8">
      <DomainChrome
        domainLabel="Herz"
        date={date}
        hrefBase="/heart"
        icon="HeartPulse"
      />

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

      <Section eyebrow="KI-Hinweise" title="Coach">
        <HeartCoachInsights daily={daily} status={dailyStatus} levers={morning?.levers ?? []} />
      </Section>

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

function HeartCoachInsights({
  daily,
  status,
  levers,
}: {
  daily: DailyInsightV2 | null;
  status: DailyStatus;
  levers: MorningLeverCard[];
}) {
  const heartCard = pickBestHeartCard(levers);
  const heartDrivers = (daily?.drivers ?? []).filter((d): d is DailyDriver =>
    typeof d?.clause === "string" && HEART_TERM_RE.test(d.clause),
  );
  const summary = daily?.summary && HEART_TERM_RE.test(daily.summary) ? daily.summary : null;
  const isReady = status === "ready" && !daily?.abstain;
  const hasContent = isReady && (summary || heartCard || heartDrivers.length > 0);

  if (!hasContent) {
    return (
      <Card variant="soft">
        <CardBody className="p-5 flex items-start gap-3">
          <span className="grid place-items-center size-8 shrink-0 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <Glyph name="Sparkles" size={14} className="text-[var(--color-heart)]" />
          </span>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[0.9375rem]">Noch keine Coach-Hinweise für Herz</span>
            <span className="text-caption">
              {status === "ready"
                ? "Der heutige Coach hat keine herzbezogenen Hebel ausgewiesen."
                : "Schau nach Mitternacht erneut vorbei — dann werden Tageshebel berechnet."}
            </span>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {summary && (
        <Card variant="soft">
          <CardBody className="p-5 flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 w-[3px] self-stretch rounded-full bg-[var(--color-heart)]"
            />
            <div className="flex flex-col gap-1.5 min-w-0">
              <Eyebrow>Zusammenfassung</Eyebrow>
              <p className="text-[0.9375rem] leading-snug text-muted max-w-[64ch]">
                {summary}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {heartCard && (
        <Card>
          <CardBody className="p-5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <Pill tone="heart" size="sm">{heartCard.lever}</Pill>
              <Pill
                tone={heartCard.confidence === "high" ? "up" : heartCard.confidence === "low" ? "down" : "steady"}
                size="sm"
              >
                {confidenceDe(heartCard.confidence)}
              </Pill>
            </div>
            <p className="text-[0.875rem] text-muted">{heartCard.trajectory}</p>
            <p className="text-[0.875rem] text-subtle">{heartCard.projection_90d}</p>
            <CoachTakeaway
              anchor={heartCard.tiny_next_step.anchor}
              tiny={heartCard.tiny_next_step.tiny}
              horizon={heartCard.tiny_next_step.horizon}
              domain="heart"
              className="mt-1"
            />
          </CardBody>
        </Card>
      )}

      {heartDrivers.length > 0 && (
        <Card variant="soft">
          <CardBody className="p-5 flex flex-col gap-2.5">
            <Eyebrow>Treiber · Herz</Eyebrow>
            <ul className="flex flex-wrap gap-1.5">
              {heartDrivers.map((d, i) => (
                <li key={i}>
                  <Pill
                    tone={d.direction === "up" ? "up" : d.direction === "down" ? "down" : "steady"}
                    size="sm"
                  >
                    <span className="num-mono">
                      {d.direction === "up" ? "↑" : d.direction === "down" ? "↓" : "→"}
                    </span>
                    <span>{d.clause}</span>
                  </Pill>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function pickBestHeartCard(cards: MorningLeverCard[]): MorningLeverCard | null {
  if (cards.length === 0) return null;
  const heartCards = cards.filter(
    (c) => c.domain === "heart" || c.domain === "cardio",
  );
  if (heartCards.length === 0) return null;
  const rank = (c: MorningLeverCard): number =>
    c.confidence === "high" ? 2 : c.confidence === "medium" ? 1 : 0;
  return [...heartCards].sort((a, b) => rank(b) - rank(a))[0];
}

function confidenceDe(c: "high" | "medium" | "low"): string {
  return c === "high" ? "hoch" : c === "low" ? "gering" : "mittel";
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
