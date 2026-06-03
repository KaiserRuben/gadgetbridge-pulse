import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";

import { getMetricDetail } from "@/lib/explore-metric-detail";
import { findExploreMetric, isExploreMetricId } from "@/lib/explore-metrics-defs";
import { getLatestDailyDate } from "@/lib/insights";
import { todayKey, addDays } from "@/lib/time";

import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { Stat } from "@/components/ui/stat";
import { FadeRise } from "@/components/motion/fade-rise";
import { NumberTicker } from "@/components/motion/number-ticker";
import {
  MetricTimelinePanel,
  MetricHistogramPanel,
  MetricWeekOverlayPanel,
  MetricSamplesPanel,
} from "@/components/explore/metric-detail-panels";

type Tone = "sleep" | "heart" | "activity" | "stress" | "body";

function domainTone(d: string): Tone {
  return (d === "sleep" || d === "heart" || d === "activity" || d === "stress" || d === "body") ? d : "heart";
}

function domainLabel(d: string): string {
  return d === "sleep" ? "Schlaf"
       : d === "heart" ? "Herz"
       : d === "activity" ? "Bewegung"
       : d === "stress" ? "Stress"
       : d === "body" ? "Körper"
       : d;
}

export default async function ExploreMetricPage({
  params,
  searchParams,
}: {
  params: Promise<{ metric: string }>;
  searchParams?: Promise<{ date?: string }>;
}) {
  noStore();
  const { metric: rawMetric } = await params;
  const sp = (await searchParams) ?? {};
  if (!isExploreMetricId(rawMetric)) notFound();
  const def = findExploreMetric(rawMetric);
  if (!def) notFound();

  const dateRaw = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;
  const date = dateRaw ?? (await getLatestDailyDate()) ?? todayKey();

  const detail = await getMetricDetail(rawMetric, date);

  const todayValue = detail.timeline_30d[detail.timeline_30d.length - 1]?.value ?? null;
  const prev = detail.timeline_30d[detail.timeline_30d.length - 2]?.value ?? null;
  const delta = todayValue != null && prev != null ? todayValue - prev : null;
  const z =
    todayValue != null && detail.timeline_baseline.mean != null && detail.timeline_baseline.std
      ? (todayValue - detail.timeline_baseline.mean) / detail.timeline_baseline.std
      : null;
  const tone = domainTone(def.domain);

  const prevDate = addDays(date, -1);
  const nextDate = addDays(date, 1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/explore", label: "Erkunden" }}
        eyebrow={`${domainLabel(def.domain)} · ${date}`}
        title={<span className="truncate">{def.label}</span>}
        trailing={
          <nav className="flex items-center gap-1">
            <Link
              href={`/explore/${rawMetric}?date=${prevDate}`}
              className="grid size-9 place-items-center rounded-[var(--radius-chip)] text-muted transition-colors hover:bg-[var(--color-surface)]/70 hover:text-[var(--color-text)]"
              aria-label="Vorheriger Tag"
            >
              <Glyph name="ChevronRight" size={16} className="rotate-180" />
            </Link>
            <Link
              href={`/explore/${rawMetric}?date=${nextDate}`}
              className="grid size-9 place-items-center rounded-[var(--radius-chip)] text-muted transition-colors hover:bg-[var(--color-surface)]/70 hover:text-[var(--color-text)]"
              aria-label="Nächster Tag"
            >
              <Glyph name="ChevronRight" size={16} />
            </Link>
          </nav>
        }
      />

      <FadeRise>
        <Card glow={tone === "body" ? "body" : tone}>
          <CardBody className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4 lg:p-6">
            <div className="flex flex-col gap-1">
              <Eyebrow>Heute</Eyebrow>
              <div className="flex items-baseline gap-1.5">
                {todayValue != null ? (
                  <NumberTicker
                    value={todayValue}
                    decimals={def.decimals}
                    className="num text-[1.75rem] font-semibold leading-none tracking-[-0.02em]"
                  />
                ) : (
                  <span className="num text-[1.75rem] font-semibold leading-none tracking-[-0.02em]">—</span>
                )}
                {def.unit && todayValue != null && (
                  <span className="num-mono text-subtle text-[0.75rem]">{def.unit}</span>
                )}
              </div>
            </div>
            <Stat
              label="14d-Mittel"
              value={detail.timeline_baseline.mean != null ? detail.timeline_baseline.mean.toFixed(def.decimals) : "—"}
              unit={def.unit}
            />
            <Stat
              label="Δ vs. Vortag"
              value={delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(def.decimals)}` : "—"}
              unit={def.unit}
            />
            <div className="flex flex-col gap-1">
              <span className="eyebrow">z-Score</span>
              <div className="flex items-baseline gap-1.5">
                <span className="num text-num-lg font-semibold">
                  {z != null ? z.toFixed(2) : "—"}
                </span>
                {z != null && (
                  <Pill tone={Math.abs(z) >= 2 ? "down" : Math.abs(z) >= 1 ? "steady" : "up"} size="sm">
                    {Math.abs(z) >= 2 ? "auffällig" : Math.abs(z) >= 1 ? "leicht ab" : "stabil"}
                  </Pill>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="30 Tage" title="Verlauf · Mittel ± σ">
        <Card>
          <CardBody className="p-5">
            <MetricTimelinePanel
              data={detail.timeline_30d}
              baseline={detail.timeline_baseline}
              tone={tone}
              unit={def.unit ?? undefined}
            />
          </CardBody>
        </Card>
      </Section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section eyebrow="Verteilung" title="30-Tage-Histogramm">
          <Card>
            <CardBody className="p-5">
              <MetricHistogramPanel bins={detail.distribution_30d} todayValue={todayValue} tone={tone} />
            </CardBody>
          </Card>
        </Section>
        <Section eyebrow="Wochen-Overlay" title="7 Tage übereinander">
          <Card>
            <CardBody className="p-5">
              <MetricWeekOverlayPanel days={detail.week_overlay} tone={tone} />
            </CardBody>
          </Card>
        </Section>
      </div>

      {detail.samples != null && (
        <Section eyebrow="Samples" title={`${detail.samples.length} Messpunkte am ${date}`}>
          <Card variant="soft">
            <CardBody className="p-4">
              <MetricSamplesPanel
                samples={detail.samples}
                unit={def.unit ?? undefined}
                decimals={def.decimals}
              />
            </CardBody>
          </Card>
        </Section>
      )}
    </div>
  );
}
