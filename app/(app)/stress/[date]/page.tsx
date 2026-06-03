import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { windowForDate } from "@/lib/time";
import { getStress } from "@/lib/queries/biometrics";
import { STRESS_BUCKETS, stressBucket } from "@/lib/constants";
import { readViewState } from "@/lib/view-state/fetcher";
import { detailToday, detailSeries, detailDates } from "@/lib/view-state/detail";
import type { ViewStateDaily } from "@/runner/v4/types.ts";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Sparkline } from "@/components/charts/sparkline";
import { BandStrip } from "@/components/charts/band-strip";
import { StressHourly } from "@/components/charts/stress-hourly";
import { FadeRise } from "@/components/motion/fade-rise";

export default async function StressDetail({ params }: { params: Promise<{ date: string }> }) {
  noStore();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const w = windowForDate(date);
  // Per-minute stress samples stay a direct DB read (raw telemetry); derived
  // scalars + trends come from the view-state tier1.detail block.
  const [samples, view] = await Promise.all([
    Promise.resolve(safeStress(w)),
    readViewState(date) as Promise<ViewStateDaily | null>,
  ]);

  const mean = detailToday(view, "stress.stress_mean");
  const max = detailToday(view, "stress.stress_max");
  const highMin = detailToday(view, "stress.high_stress_minutes");

  const meanSeries = detailSeries(view, "stress.stress_mean");
  const maxSeries = detailSeries(view, "stress.stress_max");
  const highMinSeries = detailSeries(view, "stress.high_stress_minutes");
  const dates14 = detailDates(view, "stress.stress_mean");

  // Hour-of-day stress profile for today (raw samples).
  const hourBuckets = new Array<number>(24).fill(0);
  const hourCounts = new Array<number>(24).fill(0);
  for (const s of samples) {
    if (s.stress < 0 || s.stress > 100) continue;
    const tsMs = (s.ts ?? 0) * 1000;
    if (tsMs <= 0) continue;
    const hour = new Date(tsMs).getHours();
    hourBuckets[hour] += s.stress;
    hourCounts[hour] += 1;
  }
  const hourly = hourBuckets.map((sum, i) => (hourCounts[i] > 0 ? sum / hourCounts[i] : null));

  // Time-in-zone from raw samples (~1-min cadence).
  const zoneMin: Record<string, number> = Object.fromEntries(STRESS_BUCKETS.map((b) => [b.label, 0]));
  for (const s of samples) {
    if (s.stress < 0 || s.stress > 100) continue;
    zoneMin[stressBucket(s.stress).label] += 1;
  }
  const totalMin = Object.values(zoneMin).reduce((a, b) => a + b, 0);

  const stripItems = dates14.map((d, i) => ({
    date: d,
    band: stressBand(meanSeries[i]),
    score: meanSeries[i],
  }));

  return (
    <div className="flex flex-col gap-6">
      <DomainChrome domainLabel="Stress" date={date} hrefBase="/stress" icon="Waves" />

      <div className="hidden items-center justify-between gap-3 md:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span className="eyebrow shrink-0">Letzte 14 Tage</span>
          <BandStrip items={stripItems} active={date} hrefBase="/stress/" size={22} />
        </div>
        <span className="text-caption text-muted shrink-0">Mittel</span>
      </div>

      <FadeRise>
        <Card glow="stress">
          <CardBody className="grid grid-cols-3 gap-4 p-5 lg:p-6">
            <Stat label="Mittel" value={fmtNum(mean, (v) => v.toFixed(0))} />
            <Stat label="Maximum" value={fmtNum(max, (v) => v.toFixed(0))} />
            <Stat label="Hochstress" value={fmtNum(highMin, (v) => v.toFixed(0))} unit="min" />
          </CardBody>
        </Card>
      </FadeRise>

      {mean == null && samples.length === 0 && (
        <FadeRise>
          <Card variant="soft">
            <CardBody className="grid place-items-center gap-2 p-6 text-center text-caption">
              Keine Stress-Daten für diesen Tag. Trend-Sparklines unten greifen auf die letzten 14 Tage zu.
            </CardBody>
          </Card>
        </FadeRise>
      )}

      {samples.length === 0 ? null : (
        <Section eyebrow="Tagesprofil" title="Stress je Stunde">
          <Card variant="soft">
            <CardBody className="p-5">
              <StressHourly values={hourly} height={96} />
            </CardBody>
          </Card>
        </Section>
      )}

      {totalMin > 0 && (
        <Section eyebrow="Zonen" title={`${totalMin} min mit Stress-Messung`}>
          <Card variant="soft">
            <CardBody className="flex flex-col gap-2 p-5">
              {STRESS_BUCKETS.map((b) => {
                const min = zoneMin[b.label];
                const pct = (min / totalMin) * 100;
                return (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-[88px] text-[0.875rem]">{labelDe(b.label)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: b.color }} />
                    </div>
                    <span className="num-mono text-caption w-[60px] text-right">{min}m</span>
                    <span className="num-mono text-caption text-subtle w-[42px] text-right">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </Section>
      )}

      <Section eyebrow="Trend" title="14 Tage">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <TrendCard label="Mittel" series={meanSeries} />
          <TrendCard label="Maximum" series={maxSeries} />
          <TrendCard label="Hochstress min" series={highMinSeries} />
        </div>
      </Section>
    </div>
  );
}

function TrendCard({ label, series }: { label: string; series: Array<number | null> }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-2 p-5">
        <span className="eyebrow">{label}</span>
        <Sparkline values={series} tone="stress" width={420} height={56} className="w-full" />
      </CardBody>
    </Card>
  );
}

function labelDe(en: string): string {
  return en === "Relaxed" ? "Entspannt"
    : en === "Mild" ? "Leicht"
    : en === "Moderate" ? "Moderat"
    : en === "High" ? "Hoch"
    : en;
}

function safeStress(w: { since: number; until: number }) {
  try {
    return getStress(w);
  } catch {
    return [];
  }
}

function stressBand(mean: number | null): "above_usual" | "below_usual" | "steady" | null {
  if (mean == null) return null;
  // Stress: lower is better. <30 up · 30-50 steady · >50 down.
  if (mean < 30) return "above_usual";
  if (mean > 50) return "below_usual";
  return "steady";
}

function fmtNum(v: number | null, fmt: (n: number) => string | number = (n) => n): string {
  if (v == null) return "—";
  return String(fmt(v));
}
