import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { addDays } from "@/lib/time";
import type { FactsBundleV2 } from "@/lib/types/generated";
import { composeBodyInsight } from "@/lib/derived/body-insight";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { InsightSection } from "@/components/domain/insight-section";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import { Glyph } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

export default async function BodyDetail({ params }: { params: Promise<{ date: string }> }) {
  noStore();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const dates30 = Array.from({ length: 30 }, (_, i) => addDays(date, -(29 - i)));
  const facts30 = await Promise.all(dates30.map(loadFacts));

  // Keep nulls so `composeBodyInsight` sees the same gappy 30d series the
  // trend tiles render; the compactor inside the composer drops them.
  const weight = facts30.map((f) => f?.body?.metrics?.weight_kg ?? null);
  const bodyFat = facts30.map((f) => f?.body?.metrics?.body_fat_pct ?? null);
  const bmi = facts30.map((f) => f?.body?.metrics?.bmi ?? null);
  const skinTemp = facts30.map((f) => f?.body?.metrics?.skin_temp_median ?? null);
  const skinDelta = facts30.map((f) => f?.body?.metrics?.skin_temp_delta_c ?? null);

  const today = facts30[facts30.length - 1];

  // Deterministic body insight composed from the 30d trend already in scope.
  // No LLM, no runner cluster — just rule-computed trend deltas piped into
  // the shared `<InsightSection>` shape. The body domain otherwise has no
  // coach surface at all.
  const bodyInsight = composeBodyInsight({
    weightKg: weight,
    bodyFatPct: bodyFat,
    bmi,
    skinTempMedian: skinTemp,
    skinTempDelta: skinDelta,
  });

  // 14d strip — slice last 14 from 30d. Band reflects weight change vs
  // the prior-7d baseline: stable = steady, dropping = up (good), rising
  // = down. Same band semantics as the other domain pages even though
  // "good" here is direction-dependent.
  const stripStart = dates30.length - 14;
  const stripDates = dates30.slice(stripStart);
  const stripWeights = weight.slice(stripStart);
  const baseline = (() => {
    const head = weight.slice(stripStart - 7, stripStart).filter((v): v is number => v != null);
    if (head.length === 0) return null;
    return head.reduce((a, b) => a + b, 0) / head.length;
  })();
  const stripItems = stripDates.map((d, i) => {
    const w = stripWeights[i];
    return { date: d, band: weightBand(w, baseline), score: w };
  });

  return (
    <div className="flex flex-col gap-6">
      <DomainChrome
        domainLabel="Körper"
        date={date}
        hrefBase="/body"
        icon="Thermometer"
      />

      <div className="hidden md:flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/body/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">Gewicht vs 7d-Basis</span>
      </div>

      <FadeRise>
        <InsightSection insight={bodyInsight} domainLabel="Körper" />
      </FadeRise>

      <FadeRise>
        <Card glow="body">
          <CardBody className="p-5 lg:p-6 flex flex-col gap-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Gewicht"  value={today?.body?.metrics?.weight_kg != null ? today.body.metrics.weight_kg.toFixed(1) : "—"} unit="kg" />
              <Stat label="BMI"      value={today?.body?.metrics?.bmi != null ? today.body.metrics.bmi.toFixed(1) : "—"} />
              <Stat label="Körperfett" value={today?.body?.metrics?.body_fat_pct != null ? today.body.metrics.body_fat_pct.toFixed(1) : "—"} unit="%" />
              <Stat label="Hauttemp"   value={today?.body?.metrics?.skin_temp_median != null ? today.body.metrics.skin_temp_median.toFixed(1) : "—"} unit="°C" />
            </div>
            <Link
              href="/log/weight"
              className="inline-flex items-center justify-center gap-2 self-start h-9 px-3 rounded-[var(--radius-pill)] text-caption ring-1 ring-inset ring-[var(--color-border)] bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <Glyph name="PenLine" size={12} />
              Gewicht eintragen
            </Link>
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="Trend" title="30 Tage">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TrendCard label="Gewicht"      unit="kg" series={compact(weight)}    tone="body" decimals={1} />
          <TrendCard label="Körperfett"   unit="%"  series={compact(bodyFat)}   tone="body" decimals={1} />
          <TrendCard label="BMI"          unit=""   series={compact(bmi)}       tone="body" decimals={1} />
          <TrendCard label="Hauttemp"     unit="°C" series={compact(skinTemp)}  tone="body" decimals={1} />
          <TrendCard label="Hauttemp Δ"   unit="°C" series={compact(skinDelta)} tone="body" decimals={2} signed />
        </div>
      </Section>
    </div>
  );
}

/**
 * Drop null gaps for the trend tiles, which want a dense series for the
 * sparkline + delta calc. The composer above sees the raw gappy data
 * because it needs to interpret "no measurement today" separately from
 * "measured a zero".
 */
function compact(series: (number | null)[]): number[] {
  return series.filter((v): v is number => v != null);
}

function TrendCard({
  label, series, unit, tone, decimals = 0, signed = false,
}: {
  label: string;
  series: number[];
  unit?: string;
  tone: "body";
  decimals?: number;
  signed?: boolean;
}) {
  if (series.length === 0) {
    return (
      <Card variant="soft">
        <CardBody className="p-5 flex flex-col gap-2">
          <span className="eyebrow">{label}</span>
          <span className="text-caption">Keine Daten</span>
        </CardBody>
      </Card>
    );
  }
  const last = series[series.length - 1];
  const first = series[0];
  const delta = last - first;
  const lastSign = signed && last > 0 ? "+" : signed && last < 0 ? "−" : "";
  const lastAbs = Math.abs(last).toFixed(decimals);
  return (
    <Card>
      <CardBody className="p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">{label}</span>
          <span className={`num-mono text-caption ${delta > 0 ? "text-[var(--color-band-up)]" : delta < 0 ? "text-[var(--color-band-down)]" : "text-subtle"}`}>
            {delta > 0 ? "+" : delta < 0 ? "−" : ""}{Math.abs(delta).toFixed(decimals)} {unit} 30d
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="num text-[2rem] font-semibold leading-none">{lastSign}{lastAbs}</span>
          {unit && <span className="text-subtle text-[0.875rem] num-mono">{unit}</span>}
        </div>
        <Sparkline values={series} tone={tone} width={520} height={48} className="w-full" />
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

function weightBand(
  weight: number | null,
  baseline: number | null,
): "above_usual" | "below_usual" | "steady" | null {
  if (weight == null || baseline == null) return null;
  const delta = weight - baseline;
  // ±0.5 kg of baseline = steady (typical day-to-day water-weight noise).
  if (Math.abs(delta) <= 0.5) return "steady";
  // Below baseline reads as "trending down" (often the user-desired
  // direction). Above baseline reads as "trending up".
  return delta < 0 ? "above_usual" : "below_usual";
}
