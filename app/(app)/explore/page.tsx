import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { getExploreMetrics, type ExploreMetric } from "@/lib/explore-metrics";
import { getLatestDailyDate } from "@/lib/insights";
import { todayKey } from "@/lib/time";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { Sparkline } from "@/components/charts/sparkline";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

export default async function ExplorePage() {
  noStore();
  const latest = (await getLatestDailyDate()) ?? todayKey();
  const metrics = await getExploreMetrics(latest);
  const grouped = groupByDomain(metrics);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Eyebrow>Erkunden</Eyebrow>
        <h1 className="text-hero">Alle Metriken</h1>
      </div>

      {Object.entries(grouped).map(([domain, list]) => (
        <Section key={domain} eyebrow={domainLabel(domain)} title={`${list.length} Metriken`}>
          <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3" step={0.04}>
            {list.map((m) => {
              const tone = domainTone(m.def.domain);
              const series = m.series14d.map((p) => p.value).filter((v): v is number => v != null);
              const last = m.today;
              const prev = series[series.length - 2];
              const delta = last != null && prev != null ? last - prev : null;
              const min14 = series.length > 0 ? Math.min(...series) : null;
              const max14 = series.length > 0 ? Math.max(...series) : null;
              return (
                <StaggerItem key={m.def.id}>
                  <Link href={`/explore/${m.def.id}`}>
                    <Card hoverable className="h-full">
                      <CardBody className="p-4 flex flex-col gap-2 min-h-[140px]">
                        <div className="flex items-baseline justify-between">
                          <Eyebrow>{m.def.label}</Eyebrow>
                          {delta != null && (
                            <span
                              className={`num-mono text-[0.6875rem] ${
                                delta > 0 ? "text-[var(--color-band-up)]"
                                : delta < 0 ? "text-[var(--color-band-down)]"
                                : "text-subtle"
                              }`}
                            >
                              {delta > 0 ? "+" : delta < 0 ? "−" : ""}{Math.abs(delta).toFixed(m.def.decimals)}{m.def.unit ?? ""}
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="num text-[1.5rem] font-semibold leading-none">
                            {last != null ? last.toFixed(m.def.decimals) : "—"}
                          </span>
                          {m.def.unit && last != null && (
                            <span className="text-subtle text-[0.75rem] num-mono">{m.def.unit}</span>
                          )}
                        </div>
                        <div className="mt-auto flex items-end gap-2">
                          <div className="flex flex-col justify-between text-[0.625rem] num-mono text-faint h-9 leading-none">
                            <span>{max14 != null ? max14.toFixed(m.def.decimals) : ""}</span>
                            <span>{min14 != null ? min14.toFixed(m.def.decimals) : ""}</span>
                          </div>
                          <Sparkline values={series.slice(-14)} tone={tone} width={170} height={36} className="flex-1" />
                        </div>
                        <div className="text-[0.625rem] num-mono text-faint flex justify-between">
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
      ))}

      {metrics.length === 0 && (
        <Card variant="soft">
          <CardBody className="p-6 grid place-items-center gap-2 text-center text-caption">
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
