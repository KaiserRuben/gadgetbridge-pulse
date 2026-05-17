import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { addDays } from "@/lib/time";
import type { FactsBundleV2 } from "@/lib/types/generated";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Sparkline } from "@/components/charts/sparkline";
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

  const weight = facts30.map((f) => f?.body?.metrics?.weight_kg ?? null).filter((v): v is number => v != null);
  const bodyFat = facts30.map((f) => f?.body?.metrics?.body_fat_pct ?? null).filter((v): v is number => v != null);
  const bmi = facts30.map((f) => f?.body?.metrics?.bmi ?? null).filter((v): v is number => v != null);
  const skinTemp = facts30.map((f) => f?.body?.metrics?.skin_temp_median ?? null).filter((v): v is number => v != null);
  const skinDelta = facts30.map((f) => f?.body?.metrics?.skin_temp_delta_c ?? null).filter((v): v is number => v != null);

  const today = facts30[facts30.length - 1];

  return (
    <div className="flex flex-col gap-8">
      <DomainChrome
        domainLabel="Körper"
        date={date}
        hrefBase="/body"
        icon="Thermometer"
      />

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
          <TrendCard label="Gewicht"      unit="kg" series={weight}    tone="body" decimals={1} />
          <TrendCard label="Körperfett"   unit="%"  series={bodyFat}   tone="body" decimals={1} />
          <TrendCard label="BMI"          unit=""   series={bmi}       tone="body" decimals={1} />
          <TrendCard label="Hauttemp"     unit="°C" series={skinTemp}  tone="body" decimals={1} />
          <TrendCard label="Hauttemp Δ"   unit="°C" series={skinDelta} tone="body" decimals={2} signed />
        </div>
      </Section>
    </div>
  );
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
