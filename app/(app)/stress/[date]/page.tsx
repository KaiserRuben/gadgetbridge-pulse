import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unstable_noStore as noStore } from "next/cache";

import { addDays, windowForDate } from "@/lib/time";
import { getStress } from "@/lib/queries/biometrics";
import { STRESS_BUCKETS, stressBucket } from "@/lib/constants";
import { loadDaily, loadDailyStatus } from "@/lib/insights";
import { loadMorningInsight, type MorningLeverCard } from "@/lib/v3-loaders";
import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Pill } from "@/components/ui/pill";
import { Sparkline } from "@/components/charts/sparkline";
import { CoachTakeaway } from "@/components/coach/coach-takeaway";
import { FadeRise } from "@/components/motion/fade-rise";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

export default async function StressDetail({ params }: { params: Promise<{ date: string }> }) {
  noStore();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const dates14 = Array.from({ length: 14 }, (_, i) => addDays(date, -(13 - i)));
  const w = windowForDate(date);
  const [facts14, samples, daily, dailyStatus, morning] = await Promise.all([
    Promise.all(dates14.map(loadFacts)),
    Promise.resolve(safeStress(w)),
    loadDaily(date),
    loadDailyStatus(date),
    loadMorningInsight(date),
  ]);
  const today = facts14[13];

  const stressCard = pickStressCoachingCard(morning?.levers ?? []);
  const stressDrivers = pickStressDrivers(daily);
  const stressSummary = isStressy(daily?.summary) ? daily?.summary : null;

  // Hour-of-day stress profile for today.
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

  const meanSeries = facts14.map((f) => f?.stress?.metrics?.stress_mean ?? null).filter((v): v is number => v != null);
  const maxSeries = facts14.map((f) => f?.stress?.metrics?.stress_max ?? null).filter((v): v is number => v != null);
  const highMinSeries = facts14.map((f) => f?.stress?.metrics?.high_stress_minutes ?? null).filter((v): v is number => v != null);

  // Time-in-zone: each sample is taken at ~minute cadence; map stress→bucket.
  const zoneMin: Record<string, number> = Object.fromEntries(STRESS_BUCKETS.map((b) => [b.label, 0]));
  for (const s of samples) {
    if (s.stress < 0 || s.stress > 100) continue;
    zoneMin[stressBucket(s.stress).label] += 1;
  }
  const totalMin = Object.values(zoneMin).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-8">
      <DomainChrome
        domainLabel="Stress"
        date={date}
        hrefBase="/stress"
        icon="Waves"
      />

      <FadeRise>
        <Card glow="stress">
          <CardBody className="p-5 lg:p-6 grid grid-cols-3 gap-4">
            <Stat label="Mittel"        value={today?.stress?.metrics?.stress_mean != null ? today.stress.metrics.stress_mean.toFixed(0) : "—"} />
            <Stat label="Maximum"       value={today?.stress?.metrics?.stress_max != null ? today.stress.metrics.stress_max.toFixed(0) : "—"} />
            <Stat label="Hochstress"    value={today?.stress?.metrics?.high_stress_minutes != null ? today.stress.metrics.high_stress_minutes.toFixed(0) : "—"} unit="min" />
          </CardBody>
        </Card>
      </FadeRise>

      {today?.stress?.metrics == null && samples.length === 0 && (
        <FadeRise>
          <Card variant="soft">
            <CardBody className="p-6 grid place-items-center gap-2 text-center text-caption">
              Keine Stress-Daten für diesen Tag. Trend-Sparklines unten greifen auf die letzten 14 Tage zu.
            </CardBody>
          </Card>
        </FadeRise>
      )}

      {(stressCard || stressDrivers.length > 0 || stressSummary) ? (
        <Section eyebrow="KI-Hinweise" title="Coach">
          <Card variant="soft">
            <CardBody className="p-5 flex flex-col gap-3">
              {stressSummary && (
                <p className="text-body text-muted max-w-[64ch]">{stressSummary}</p>
              )}
              {stressDrivers.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {stressDrivers.map((d, i) => (
                    <li key={i}>
                      <Pill tone={d.direction === "up" ? "down" : d.direction === "down" ? "up" : "steady"} size="sm">
                        <span className="num-mono opacity-70 mr-1">{d.direction === "up" ? "↑" : d.direction === "down" ? "↓" : "→"}</span>
                        {d.clause}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}
              {stressCard && (
                <CoachTakeaway
                  anchor={stressCard.tiny_next_step.anchor}
                  tiny={stressCard.tiny_next_step.tiny}
                  horizon={stressCard.tiny_next_step.horizon}
                  domain="stress"
                  className="mt-1"
                />
              )}
            </CardBody>
          </Card>
        </Section>
      ) : (
        dailyStatus !== "ready" && (
          <Card variant="soft">
            <CardBody className="p-5 text-caption text-subtle">
              Noch keine Coach-Hinweise — der Tages-Insight wird nach Mitternacht final berechnet.
            </CardBody>
          </Card>
        )
      )}

      {(() => {
        const hasHourly = hourly.some((v) => v != null);
        if (samples.length === 0) return null;
        return (
          <Section eyebrow="Tagesprofil" title="Stress je Stunde">
            <Card variant="soft">
              <CardBody className="p-5 flex flex-col gap-2">
                {hasHourly ? (
                  <>
                    <div className="flex items-end gap-1 h-24">
                      {(() => {
                        const peak = Math.max(20, ...hourly.filter((v): v is number => v != null));
                        return hourly.map((v, h) => {
                          const height = v != null ? Math.max(4, (v / peak) * 100) : 2;
                          const bucket = v != null ? stressBucket(v) : STRESS_BUCKETS[0];
                          return (
                            <div key={h} className="flex-1 h-full flex flex-col-reverse items-center">
                              <div
                                className="w-full rounded-sm"
                                style={{
                                  height: `${height}%`,
                                  backgroundColor: v != null ? bucket.color : "var(--color-border)",
                                  opacity: v != null ? 1 : 0.3,
                                }}
                                title={v != null ? `${h}:00 — ${v.toFixed(0)}` : `${h}:00 — keine Daten`}
                              />
                            </div>
                          );
                        });
                      })()}
                    </div>
                    <div className="flex justify-between text-[0.625rem] num-mono text-faint">
                      <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
                    </div>
                  </>
                ) : (
                  <div className="h-24 grid place-items-center text-caption text-subtle">
                    Stundenprofil noch nicht verfügbar.
                  </div>
                )}
              </CardBody>
            </Card>
          </Section>
        );
      })()}

      {totalMin > 0 && (
        <Section eyebrow="Zonen" title={`${totalMin} min mit Stress-Messung`}>
          <Card variant="soft">
            <CardBody className="p-5 flex flex-col gap-2">
              {STRESS_BUCKETS.map((b) => {
                const min = zoneMin[b.label];
                const pct = (min / totalMin) * 100;
                return (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-[88px] text-[0.875rem]">{labelDe(b.label)}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden bg-[var(--color-bg-elevated)]">
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card>
            <CardBody className="p-5 flex flex-col gap-2">
              <span className="eyebrow">Mittel</span>
              <Sparkline values={meanSeries} tone="stress" width={420} height={56} className="w-full" />
            </CardBody>
          </Card>
          <Card>
            <CardBody className="p-5 flex flex-col gap-2">
              <span className="eyebrow">Maximum</span>
              <Sparkline values={maxSeries} tone="stress" width={420} height={56} className="w-full" />
            </CardBody>
          </Card>
          <Card>
            <CardBody className="p-5 flex flex-col gap-2">
              <span className="eyebrow">Hochstress min</span>
              <Sparkline values={highMinSeries} tone="stress" width={420} height={56} className="w-full" />
            </CardBody>
          </Card>
        </div>
      </Section>
    </div>
  );
}

function labelDe(en: string): string {
  return en === "Relaxed" ? "Entspannt"
       : en === "Mild" ? "Leicht"
       : en === "Moderate" ? "Moderat"
       : en === "High" ? "Hoch"
       : en;
}

function pickStressCoachingCard(cards: MorningLeverCard[]): MorningLeverCard | null {
  return cards.find((c) => c.domain === "stress") ?? null;
}

function pickStressDrivers(d: DailyInsightV2 | null): { clause: string; direction: "up" | "down" | "flat" }[] {
  if (!d?.drivers) return [];
  const re = /stress|hrv|atem|atmung|recovery|erholung|hochstress/i;
  return d.drivers.filter((dr) => re.test(dr.clause)).map((dr) => ({ clause: dr.clause, direction: dr.direction }));
}

function isStressy(text: string | null | undefined): boolean {
  if (!text) return false;
  return /stress|atem|atmung|hrv|hochstress|recovery|erholung/i.test(text);
}

function safeStress(w: { since: number; until: number }) {
  try {
    return getStress(w);
  } catch {
    return [];
  }
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
