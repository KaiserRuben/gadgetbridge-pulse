import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { getWorkouts } from "@/lib/queries/workouts";
import { stitchWorkouts, STITCH_GAP_MAX_SEC, type StitchedSession } from "@/lib/queries/workout-stitch";
import { fmtInt } from "@/lib/format";

import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { NumberTicker } from "@/components/motion/number-ticker";

export default async function ActivitiesPage() {
  noStore();
  const workouts = getWorkouts({ limit: 400 });
  const sessions = stitchWorkouts(workouts);
  const stitchedCount = sessions.filter((s) => s.isStitched).length;
  const grouped = groupByMonth(sessions);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`${sessions.length} Sessions · ${stitchedCount} zusammengefügt`}
        title="Aktivitäten"
        sub={
          <>
            Alle aufgezeichneten Trainings und Sessions. Workouts gleicher Art mit ≤ {Math.round(STITCH_GAP_MAX_SEC / 60)} Min.
            Pause werden zu einer Session zusammengefügt — diese sind hervorgehoben und enthalten ein einklappbares
            Dropdown mit den einzelnen Segmenten.
          </>
        }
        trailing={
          <div className="flex flex-col items-end gap-0.5">
            <NumberTicker value={sessions.length} className="num text-h2 leading-none text-[var(--color-text-strong)]" />
            <span className="eyebrow">Sessions</span>
          </div>
        }
      />

      {sessions.length === 0 && (
        <FadeRise>
          <Card variant="soft">
            <CardBody className="grid place-items-center gap-2 p-6 text-center text-caption">
              <IconBadge icon="Activity" tone="activity" size="md" />
              Noch keine aufgezeichneten Aktivitäten.
            </CardBody>
          </Card>
        </FadeRise>
      )}

      {Object.entries(grouped).map(([monthKey, list]) => (
        <Section key={monthKey} eyebrow={fmtMonth(monthKey)} title={`${list.length} Sessions`}>
          <Stagger className="flex flex-col gap-3" step={0.04}>
            {list.map((s) => (
              <StaggerItem key={s.id}>
                <SessionCard session={s} />
              </StaggerItem>
            ))}
          </Stagger>
        </Section>
      ))}
    </div>
  );
}

function SessionCard({ session: s }: { session: StitchedSession }) {
  const sessionHref = s.isStitched ? `/activities/${s.id}` : `/workouts/${s.primaryId}`;
  const maxRecoveryHours = s.members.reduce<number>((acc, m) => {
    return m.recoveryHours != null && m.recoveryHours > acc ? m.recoveryHours : acc;
  }, 0);
  const needsRecovery = maxRecoveryHours >= 24;
  return (
    <Card
      hoverable
      variant={s.isStitched ? "soft" : "surface"}
      glow={s.isStitched ? "activity" : undefined}
      className="group"
    >
      <CardBody className="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-4">
          <IconBadge
            icon={s.typeIcon as GlyphName}
            tone="activity"
            size="lg"
            variant={s.isStitched ? "solid" : "soft"}
          />
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <Link href={sessionHref} className="text-title hover:underline">
                {s.typeLabel}
                {s.isStitched && (
                  <span className="ml-2 text-caption text-muted">
                    · Session · Karte ansehen →
                  </span>
                )}
              </Link>
              <span className="num-mono text-caption">{fmtDt(s.startTs)}</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap text-caption">
              <span className="num-mono">{fmtDuration(s.durationSec)}</span>
              <span className="text-faint">·</span>
              <span className="num-mono">{(s.distanceM / 1000).toFixed(2)} km</span>
              <span className="text-faint">·</span>
              <span className="num-mono">{fmtInt(s.calories)} kcal</span>
              {s.hrMax != null && (
                <>
                  <span className="text-faint">·</span>
                  <span className="num-mono">↑{s.hrMax} bpm</span>
                </>
              )}
              {s.elevationGain != null && s.elevationGain > 0 && (
                <>
                  <span className="text-faint">·</span>
                  <span className="num-mono">↑{fmtInt(s.elevationGain)} m</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {s.isStitched && (
                <Pill tone="activity" size="sm">
                  <Glyph name="GitMerge" size={10} className="mr-1" />
                  Session · {s.members.length} Segmente
                </Pill>
              )}
              {s.reclassifiedAny && (
                <Pill tone="neutral" size="sm">auto-klassifiziert</Pill>
              )}
              {s.gpxPaths.length > 0 && (
                <Pill tone="neutral" size="sm">GPX × {s.gpxPaths.length}</Pill>
              )}
              {s.workoutLoadSum != null && s.workoutLoadSum > 0 && (
                <Pill tone="neutral" size="sm" className="num-mono">Last {s.workoutLoadSum}</Pill>
              )}
              {needsRecovery && (
                <Pill tone="down" size="sm">
                  <Glyph name="Gauge" size={10} className="mr-1" />
                  Erholung benötigt · {Math.round(maxRecoveryHours)} h
                </Pill>
              )}
            </div>
          </div>
        </div>

        {s.isStitched && (
          <details className="group/seg mt-1 pl-16 ml-6 border-l border-[var(--color-border)]">
            <summary className="cursor-pointer list-none flex items-center gap-1.5 py-1 text-caption text-subtle hover:text-[var(--color-text)] -ml-2 pl-2">
              <Glyph name="ChevronRight" size={12} className="transition-transform group-open/seg:rotate-90" />
              <span>{s.members.length} Segmente einblenden</span>
            </summary>
            <ol className="flex flex-col gap-1 mt-1">
              {s.members.map((m, i) => {
                const next = s.members[i + 1];
                const gap = next ? next.startTs - m.endTs : null;
                return (
                  <li key={m.id} className="flex flex-col gap-0.5">
                    <Link
                      href={`/workouts/${m.id}`}
                      className="flex items-center gap-3 py-1.5 hover:bg-[var(--color-surface)]/50 rounded-[var(--radius-sm)] -mx-2 px-2 text-caption transition-colors"
                    >
                      <span className="num-mono text-faint w-7">#{i + 1}</span>
                      <span className="num-mono w-20">{fmtTime(m.startTs)}</span>
                      <span className="num-mono">{fmtDuration(m.durationSec)}</span>
                      <span className="text-faint">·</span>
                      <span className="num-mono">{(m.distanceM / 1000).toFixed(2)} km</span>
                      {m.type !== s.type && (
                        <span className="ml-auto">
                          <Pill tone="neutral" size="sm">{m.typeLabel}</Pill>
                        </span>
                      )}
                      {m.hasGpx && (
                        <span className={m.type !== s.type ? "" : "ml-auto"}>
                          <Pill tone="neutral" size="sm">GPX</Pill>
                        </span>
                      )}
                      <Glyph name="ChevronRight" size={12} className="text-faint" />
                    </Link>
                    {gap != null && gap > 0 && (
                      <span className="num-mono text-tick text-faint pl-10">
                        Pause {Math.round(gap / 60)} min
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

function groupByMonth(sessions: StitchedSession[]): Record<string, StitchedSession[]> {
  const out: Record<string, StitchedSession[]> = {};
  for (const s of sessions) {
    const dt = new Date(s.startTs * 1000);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    out[key] ??= [];
    out[key].push(s);
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

function fmtTime(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
