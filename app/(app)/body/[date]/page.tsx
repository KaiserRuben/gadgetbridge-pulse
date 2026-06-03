import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { readViewState } from "@/lib/view-state/fetcher";
import { detailToday, detailSeries, detailDates } from "@/lib/view-state/detail";
import type { ViewStateDaily } from "@/runner/v4/types.ts";

import { DomainDetailHeader } from "@/components/view/DomainDetailHeader";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import { Glyph } from "@/components/ui/glyph";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

export default async function BodyDetail({ params }: { params: Promise<{ date: string }> }) {
  noStore();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const view = (await readViewState(date)) as ViewStateDaily | null;
  const m = (id: string) => detailToday(view, `body.${id}`);

  const weight = detailSeries(view, "body.weight_kg");
  const bodyFat = detailSeries(view, "body.body_fat_pct");
  const bmi = detailSeries(view, "body.bmi");
  const skinTemp = detailSeries(view, "body.skin_temp_median");
  const skinDelta = detailSeries(view, "body.skin_temp_delta_c");
  const dates14 = detailDates(view, "body.weight_kg");

  // 14d weight strip — band vs the prior-week baseline (head of the window).
  const baseline = (() => {
    const head = weight.slice(0, 7).filter((v): v is number => v != null);
    if (head.length === 0) return null;
    return head.reduce((a, b) => a + b, 0) / head.length;
  })();
  const stripItems = dates14.map((d, i) => ({
    date: d,
    band: weightBand(weight[i], baseline),
    score: weight[i],
  }));

  const bmiVal = m("bmi");
  const skinTempVal = m("skin_temp_median");
  const support =
    [
      bmiVal != null ? `BMI ${bmiVal.toFixed(1)}` : null,
      skinTempVal != null ? `Hauttemp ${skinTempVal.toFixed(1)}°C` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  const bodyFatVal = m("body_fat_pct");

  return (
    <div className="flex flex-col gap-6">
      <DomainDetailHeader
        domainLabel="Körper"
        date={date}
        hrefBase="/body"
        tone="body"
        hero={{ value: m("weight_kg"), fmt: "dec1", unit: "kg", label: "Gewicht" }}
        support={support}
        trend={{ series: weight, label: "Gewicht" }}
      />

      <div className="hidden items-center justify-between gap-3 md:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/body/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">Gewicht vs 7d-Basis</span>
      </div>

      <Stagger className="flex flex-col gap-6">
        <StaggerItem>
          <Card glow="body">
            <CardBody className="flex flex-col gap-4 p-5 lg:p-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Gewicht" value={fmtNum(m("weight_kg"), (v) => v.toFixed(1))} unit="kg" />
                <Stat label="BMI" value={fmtNum(bmiVal, (v) => v.toFixed(1))} />
                <Stat
                  label="Körperfett"
                  value={fmtNum(bodyFatVal, (v) => v.toFixed(1))}
                  {...(bodyFatVal != null ? { unit: "%" } : {})}
                />
                <Stat label="Hauttemp" value={fmtNum(skinTempVal, (v) => v.toFixed(1))} unit="°C" />
              </div>
              <Link
                href="/log/weight"
                className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-[var(--radius-pill)] bg-[var(--color-surface-2)] px-3 text-caption ring-1 ring-inset ring-[var(--color-border)] transition-colors hover:text-[var(--color-text)]"
              >
                <Glyph name="PenLine" size={12} />
                Gewicht eintragen
              </Link>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Section eyebrow="Trend" title="14 Tage">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <TrendCard label="Gewicht" unit="kg" series={weight} decimals={1} />
              <TrendCard label="Körperfett" unit="%" series={bodyFat} decimals={1} />
              <TrendCard label="BMI" unit="" series={bmi} decimals={1} />
              <TrendCard label="Hauttemp" unit="°C" series={skinTemp} decimals={1} />
              <TrendCard label="Hauttemp Δ" unit="°C" series={skinDelta} decimals={2} signed />
            </div>
          </Section>
        </StaggerItem>
      </Stagger>
    </div>
  );
}

function TrendCard({
  label,
  series,
  unit,
  decimals = 0,
  signed = false,
}: {
  label: string;
  series: Array<number | null>;
  unit?: string;
  decimals?: number;
  signed?: boolean;
}) {
  const clean = series.filter((v): v is number => v != null);
  if (clean.length === 0) {
    return (
      <Card variant="soft">
        <CardBody className="flex flex-col gap-2 p-5">
          <span className="eyebrow">{label}</span>
          <span className="text-caption text-subtle">Noch keine Messung</span>
        </CardBody>
      </Card>
    );
  }
  const last = clean[clean.length - 1];
  const first = clean[0];
  const delta = last - first;
  const lastSign = signed && last > 0 ? "+" : signed && last < 0 ? "−" : "";
  const lastAbs = Math.abs(last).toFixed(decimals);
  return (
    <Card>
      <CardBody className="flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">{label}</span>
          <span
            className={`num-mono text-caption ${delta > 0 ? "text-[var(--color-band-up)]" : delta < 0 ? "text-[var(--color-band-down)]" : "text-subtle"}`}
          >
            {delta > 0 ? "+" : delta < 0 ? "−" : ""}
            {Math.abs(delta).toFixed(decimals)} {unit} 14d
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="num text-[2rem] font-semibold leading-none">
            {lastSign}
            {lastAbs}
          </span>
          {unit && <span className="text-subtle num-mono text-[0.875rem]">{unit}</span>}
        </div>
        <Sparkline values={series} tone="body" width={520} height={48} markers className="w-full" />
      </CardBody>
    </Card>
  );
}

function weightBand(
  weight: number | null,
  baseline: number | null,
): "above_usual" | "below_usual" | "steady" | null {
  if (weight == null || baseline == null) return null;
  const delta = weight - baseline;
  if (Math.abs(delta) <= 0.5) return "steady";
  return delta < 0 ? "above_usual" : "below_usual";
}

function fmtNum(v: number | null, fmt: (n: number) => string | number = (n) => n): string {
  if (v == null) return "—";
  return String(fmt(v));
}
