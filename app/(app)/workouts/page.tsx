import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { getWorkouts, workoutTypeIcon, type WorkoutSummary } from "@/lib/queries/workouts";
import { fmtInt } from "@/lib/format";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyStateCard } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

export default async function WorkoutsPage() {
  noStore();
  const workouts = getWorkouts({ limit: 200 });
  const grouped = groupByMonth(workouts);

  return (
    <div className="flex flex-col gap-8">
      <FadeRise>
        <div className="flex flex-col gap-1">
          <Eyebrow>Trainings · {workouts.length} gesamt</Eyebrow>
          <h1 className="text-hero">Workouts</h1>
        </div>
      </FadeRise>

      {workouts.length === 0 && (
        <EmptyStateCard cause="no_data" headline="Keine Workouts erfasst" />
      )}

      {Object.entries(grouped).map(([monthKey, list]) => (
        <Section key={monthKey} eyebrow={fmtMonth(monthKey)} title={`${list.length} Einheiten`}>
          <Stagger className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3" step={0.04}>
            {list.map((w) => (
              <StaggerItem key={w.id}>
                <Link href={`/workouts/${w.id}`} className="block">
                  <Card hoverable className="group">
                    <CardBody className="p-5 flex items-start gap-4">
                      <span className="grid place-items-center size-12 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-activity)] shrink-0">
                        <Glyph name={workoutTypeIcon(w.type) as GlyphName} size={20} />
                      </span>
                      <div className="flex flex-col gap-2 min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[1.0625rem] font-medium">{w.typeLabel}</span>
                          <span className="num-mono text-caption">{fmtDt(w.startTs)}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap text-caption">
                          <span className="num-mono">{fmtDuration(w.durationSec)}</span>
                          <span className="text-faint">·</span>
                          <span className="num-mono">{(w.distanceM / 1000).toFixed(2)} km</span>
                          <span className="text-faint">·</span>
                          <span className="num-mono">{fmtInt(w.calories)} kcal</span>
                          {w.hrMax != null && (
                            <>
                              <span className="text-faint">·</span>
                              <span className="num-mono">↑{w.hrMax} bpm</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {w.aerobicEffect != null && (
                            <Pill tone="activity" size="sm" className="num-mono">aerob {w.aerobicEffect}</Pill>
                          )}
                          {w.anaerobicEffect != null && (
                            <Pill tone="heart" size="sm" className="num-mono">anaerob {w.anaerobicEffect}</Pill>
                          )}
                          {w.workoutLoad != null && w.workoutLoad > 0 && (
                            <Pill tone="neutral" size="sm" className="num-mono">Last {w.workoutLoad}</Pill>
                          )}
                          {w.recoveryHours != null && (
                            <Pill tone="steady" size="sm" className="num-mono">→ {w.recoveryHours}h Erholung</Pill>
                          )}
                          {w.hasGpx && (
                            <Pill tone="neutral" size="sm">GPX</Pill>
                          )}
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>
      ))}
    </div>
  );
}

function groupByMonth(workouts: WorkoutSummary[]): Record<string, WorkoutSummary[]> {
  const out: Record<string, WorkoutSummary[]> = {};
  for (const w of workouts) {
    const dt = new Date(w.startTs * 1000);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    out[key] ??= [];
    out[key].push(w);
  }
  return out;
}

function fmtMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("de-DE", {
    month: "long", year: "numeric", timeZone: "Europe/Berlin",
  });
}

function fmtDt(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleString("de-DE", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
