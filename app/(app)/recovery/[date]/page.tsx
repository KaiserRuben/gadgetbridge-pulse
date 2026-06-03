import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { readViewState } from "@/lib/view-state/fetcher";
import { detailToday, detailSeries } from "@/lib/view-state/detail";
import type { ViewStateDaily } from "@/runner/v4/types.ts";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Sparkline } from "@/components/charts/sparkline";
import { FadeRise } from "@/components/motion/fade-rise";

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

  return (
    <div className="flex flex-col gap-6">
      <DomainChrome domainLabel="Erholung" date={date} hrefBase="/recovery" icon="HeartPulse" />

      <FadeRise>
        <Card glow="heart">
          <CardBody className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4 lg:p-6">
            <Stat label="RMSSD" value={fmtNum(rmssd, Math.round)} unit="ms" />
            <Stat
              label="RHR-Drift"
              value={fmtNum(rhrDrift)}
              unit="bpm"
              hint={rhrDrift != null ? (rhrDrift > 5 ? "sympathisch dominant" : "gut erholt") : undefined}
            />
            <Stat label="Stress ⌀" value={fmtNum(stressMean, (v) => v.toFixed(0))} />
            <Stat label="SpO₂ min" value={fmtNum(spo2Min, Math.round)} unit="%" />
          </CardBody>
        </Card>
      </FadeRise>

      <FadeRise>
        <Card>
          <CardBody className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">RMSSD-Trend · 14 Tage</span>
              <span className="text-caption text-muted">ms</span>
            </div>
            <Sparkline values={rmssdSeries} tone="hrv" width={600} height={120} className="w-full" />
          </CardBody>
        </Card>
      </FadeRise>

      <FadeRise>
        <Card>
          <CardBody className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Ruhepuls Schlaf · 14 Tage</span>
              <span className="text-caption text-muted">bpm</span>
            </div>
            <Sparkline values={rhrSeries} tone="heart" width={600} height={120} className="w-full" />
          </CardBody>
        </Card>
      </FadeRise>
    </div>
  );
}

function fmtNum(v: number | null, fmt: (n: number) => string | number = (n) => n): string {
  if (v == null) return "—";
  return String(fmt(v));
}
