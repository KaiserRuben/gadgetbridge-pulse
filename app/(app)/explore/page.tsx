import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { getExploreMetrics, type ExploreMetric } from "@/lib/explore-metrics";
import { getLatestDailyDate } from "@/lib/insights";
import { todayKey } from "@/lib/time";

import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { IconBadge } from "@/components/ui/icon-badge";
import { Sparkline } from "@/components/charts/sparkline";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { NumberTicker } from "@/components/motion/number-ticker";

export default async function ExplorePage() {
  noStore();
  const latest = (await getLatestDailyDate()) ?? todayKey();
  const metrics = await getExploreMetrics(latest);
  const grouped = groupByDomain(metrics);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Erkunden"
        title="Alle Metriken"
        sub={`${metrics.length} Metriken · Stand ${latest}`}
      />

      {Object.entries(grouped).map(([domain, list]) => (
        <FadeRise key={domain}>
          <Section
            eyebrow={domainLabel(domain)}
            title={`${list.length} Metriken`}
            trailing={
              <IconBadge icon={domainGlyph(domain)} tone={domainTone(domain)} size="sm" />
            }
          >
            <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4" step={0.04}>
              {list.map((m) => {
                const tone = domainTone(m.def.domain);
                const series = m.series14d
                  .map((p) => p.value)
                  .filter((v): v is number => v != null);
                const last = m.today;
                const prev = series[series.length - 2];
                const delta = last != null && prev != null ? last - prev : null;
                const min14 = series.length > 0 ? Math.min(...series) : null;
                const max14 = series.length > 0 ? Math.max(...series) : null;
                return (
                  <StaggerItem key={m.def.id}>
                    <Link href={`/explore/${m.def.id}`}>
                      <Card hoverable className="h-full">
                        <CardBody className="flex min-h-[140px] flex-col gap-2 p-4">
                          <div className="flex items-baseline justify-between">
                            <Eyebrow>{m.def.label}</Eyebrow>
                            {delta != null && (
                              <span
                                className={`num-mono text-[0.6875rem] ${
                                  delta > 0
                                    ? "text-[var(--color-band-up)]"
                                    : delta < 0
                                      ? "text-[var(--color-band-down)]"
                                      : "text-subtle"
                                }`}
                              >
                                {delta > 0 ? "+" : delta < 0 ? "−" : ""}
                                {Math.abs(delta).toFixed(m.def.decimals)}
                                {m.def.unit ?? ""}
                              </span>
                            )}
                          </div>
                          <div className="flex items-baseline gap-1.5">
                            {last != null ? (
                              <NumberTicker
                                value={last}
                                decimals={m.def.decimals}
                                className="num text-num-lg font-semibold leading-none"
                              />
                            ) : (
                              <span className="num text-num-lg font-semibold leading-none">—</span>
                            )}
                            {m.def.unit && last != null && (
                              <span className="num-mono text-subtle text-[0.75rem]">{m.def.unit}</span>
                            )}
                          </div>
                          <div className="mt-auto flex items-end gap-2">
                            <div className="flex h-9 flex-col justify-between text-tick num-mono text-faint leading-none">
                              <span>{max14 != null ? max14.toFixed(m.def.decimals) : ""}</span>
                              <span>{min14 != null ? min14.toFixed(m.def.decimals) : ""}</span>
                            </div>
                            <Sparkline values={series.slice(-14)} tone={tone} width={170} height={36} className="flex-1" />
                          </div>
                          <div className="flex justify-between text-tick num-mono text-faint">
                            <span>14d</span>
                            <span>heute</span>
                          </div>
                        </CardBody>
                      </Card>
                    </Link>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </Section>
        </FadeRise>
      ))}

      {metrics.length === 0 && (
        <Card variant="soft">
          <CardBody className="grid place-items-center gap-2 p-6 text-center text-caption">
            <Glyph name="LineChart" size={18} className="text-subtle" />
            Noch keine Metriken — der Runner muss zuerst Facts schreiben.
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function groupByDomain(metrics: ExploreMetric[]): Record<string, ExploreMetric[]> {
  const out: Record<string, ExploreMetric[]> = {};
  for (const m of metrics) {
    const d = m.def.domain;
    out[d] = out[d] ?? [];
    out[d].push(m);
  }
  const order = ["sleep", "heart", "activity", "stress", "body"];
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)),
  );
}

function domainLabel(d: string): string {
  return d === "sleep" ? "Schlaf"
       : d === "heart" ? "Herz"
       : d === "activity" ? "Bewegung"
       : d === "stress" ? "Stress"
       : d === "body" ? "Körper"
       : d;
}

function domainTone(d: string): "sleep" | "heart" | "activity" | "stress" | "body" {
  return (d === "sleep" || d === "heart" || d === "activity" || d === "stress" || d === "body") ? d : "sleep";
}

function domainGlyph(d: string): GlyphName {
  return d === "sleep" ? "Moon"
       : d === "heart" ? "HeartPulse"
       : d === "activity" ? "Footprints"
       : d === "stress" ? "Brain"
       : d === "body" ? "Thermometer"
       : "LineChart";
}
