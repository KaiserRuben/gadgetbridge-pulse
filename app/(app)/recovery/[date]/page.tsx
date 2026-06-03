import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { readViewState } from "@/lib/view-state/fetcher";
import { detailToday, detailSeries, detailDates } from "@/lib/view-state/detail";
import type { ViewStateDaily } from "@/runner/v4/types.ts";

import { DomainDetailHeader } from "@/components/view/DomainDetailHeader";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

export default async function RecoveryDetail({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  noStore();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const view = (await readViewState(date)) as ViewStateDaily | null;

  const rmssd = detailToday(view, "sleep.rmssd_ms");
  const rhrDay = detailToday(view, "cardio.rhr_day_bpm");
  const rhrSleep = detailToday(view, "sleep.rhr_sleep_bpm");
  const rhrDrift = rhrDay != null && rhrSleep != null ? Math.round(rhrDay - rhrSleep) : null;
  const stressMean = detailToday(view, "stress.stress_mean");
  const spo2Min = detailToday(view, "sleep.spo2_min_pct");

  const rmssdSeries = detailSeries(view, "sleep.rmssd_ms");
  const rhrSeries = detailSeries(view, "sleep.rhr_sleep_bpm");
  const dates14 = detailDates(view, "sleep.rmssd_ms");

  // Recovery banding is adaptive: higher RMSSD than the person's own 14-day
  // baseline reads as a recovered day, lower as a taxed one.
  const rmssdPresent = rmssdSeries.filter((v): v is number => v != null);
  const baseline =
    rmssdPresent.length > 0
      ? rmssdPresent.reduce((a, b) => a + b, 0) / rmssdPresent.length
      : null;
  const stripItems = dates14.map((d, i) => ({
    date: d,
    band: rmssdBand(rmssdSeries[i], baseline),
    score: rmssdSeries[i],
  }));

  const support = [
    rhrDrift != null ? `RHR-Drift ${rhrDrift} bpm` : null,
    stressMean != null ? `Stress ⌀ ${Math.round(stressMean)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const readiness =
    rhrDrift != null && rhrDrift > 5
      ? "Sympathisch dominant — der Körper steht noch unter Last."
      : rhrDrift != null
        ? "Gut erholt — parasympathisch dominant."
        : "Noch keine Drift-Daten.";

  return (
    <div className="flex flex-col gap-6">
      <DomainDetailHeader
        domainLabel="Erholung"
        date={date}
        hrefBase="/recovery"
        tone="hrv"
        hero={{ value: rmssd, fmt: "int", unit: "ms", label: "RMSSD" }}
        support={support || null}
        trend={{ series: rmssdSeries, label: "RMSSD" }}
      />

      <div className="hidden items-center justify-between gap-3 md:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/recovery/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">RMSSD</span>
      </div>

      <Stagger className="flex flex-col gap-6">
        <StaggerItem>
          <Card variant="soft">
            <CardBody className="flex flex-col gap-1.5 p-5">
              <span className="eyebrow">Bereitschaft</span>
              <p className="text-[0.9375rem] text-[var(--color-text)]">{readiness}</p>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card glow="heart">
            <CardBody className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4 lg:p-6">
              <Stat
                label="RHR-Drift"
                value={fmtNum(rhrDrift)}
                unit="bpm"
                hint={rhrDrift != null ? (rhrDrift > 5 ? "sympathisch dominant" : "gut erholt") : undefined}
              />
              <Stat label="RHR Schlaf" value={fmtNum(rhrSleep, Math.round)} unit="bpm" />
              <Stat label="RHR Tag" value={fmtNum(rhrDay, Math.round)} unit="bpm" />
              <Stat label="Stress ⌀" value={fmtNum(stressMean, (v) => v.toFixed(0))} />
              <Stat label="SpO₂ min" value={fmtNum(spo2Min, Math.round)} unit="%" />
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <CardBody className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">RMSSD · 14 Tage</span>
                  <span className="text-caption text-muted">ms</span>
                </div>
                <Sparkline values={rmssdSeries} tone="hrv" width={560} height={150} markers className="w-full" />
              </CardBody>
            </Card>
            <Card>
              <CardBody className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Ruhepuls Schlaf · 14 Tage</span>
                  <span className="text-caption text-muted">bpm</span>
                </div>
                <Sparkline values={rhrSeries} tone="heart" width={560} height={150} markers className="w-full" />
              </CardBody>
            </Card>
          </div>
        </StaggerItem>

        <StaggerItem className="md:hidden">
          <Card variant="soft">
            <CardBody className="overflow-x-auto p-5">
              <BandStrip items={stripItems} hrefBase="/recovery/" active={date} />
            </CardBody>
          </Card>
        </StaggerItem>
      </Stagger>
    </div>
  );
}

function rmssdBand(
  v: number | null,
  baseline: number | null,
): "above_usual" | "below_usual" | "steady" | null {
  if (v == null || baseline == null) return null;
  if (v >= baseline * 1.1) return "above_usual";
  if (v <= baseline * 0.9) return "below_usual";
  return "steady";
}

function fmtNum(v: number | null, fmt: (n: number) => string | number = (n) => n): string {
  if (v == null) return "—";
  return String(fmt(v));
}
