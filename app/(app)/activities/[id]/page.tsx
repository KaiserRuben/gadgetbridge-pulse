import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

import { getWorkouts } from "@/lib/queries/workouts";
import { stitchWorkouts } from "@/lib/queries/workout-stitch";
import { loadStitchedGpx } from "@/lib/queries/gpx";
import { fmtInt } from "@/lib/format";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";
import { GpsMapClient } from "@/components/charts/gps-map-client";

export default async function StitchedActivityPage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  const { id } = await params;

  // Stitch the full window so the same session id resolves whether it is a
  // 1-segment or N-segment session.
  const all = getWorkouts({ limit: 400 });
  const sessions = stitchWorkouts(all);
  const session = sessions.find((s) => s.id === id);
  if (!session) notFound();

  const gpx = session.gpxPaths.length > 0 ? await loadStitchedGpx(session.gpxPaths) : null;
  const trackPoints = gpx ? gpx.points.map((p) => ({ lat: p.lat, lon: p.lon })) : [];

  // Recovery: take the latest member's recovery prescription as the binding
  // window — Huawei resets the timer per workout, so the most recent one is
  // what's still ticking down.
  const latestMember = session.members[session.members.length - 1];
  const recoveryHours = latestMember?.recoveryHours ?? null;
  const recoveryUntilDate =
    recoveryHours != null && recoveryHours > 0
      ? new Date((latestMember.endTs + recoveryHours * 3600) * 1000)
      : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <Link href="/activities" className="flex items-center gap-1 text-caption text-muted hover:text-[var(--color-text)]">
          <Glyph name="ChevronRight" size={14} className="rotate-180" />
          Aktivitäten
        </Link>
        <span className="num-mono text-caption">{session.isStitched ? `${session.members.length} Segmente` : "Einzelsession"}</span>
      </div>

      <FadeRise>
        <Card glow="activity">
          <CardBody className="p-5 lg:p-6 flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <span className="grid place-items-center size-14 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-activity)] shrink-0">
                <Glyph name={session.typeIcon as GlyphName} size={24} />
              </span>
              <div className="flex flex-col gap-1.5 min-w-0">
                <Eyebrow>{fmtDt(session.startTs)} → {fmtDt(session.endTs)}</Eyebrow>
                <h1 className="text-hero">{session.typeLabel}</h1>
                <div className="flex items-center gap-2 flex-wrap text-caption">
                  <span className="num-mono">{fmtDuration(session.durationSec)}</span>
                  <span className="text-faint">·</span>
                  <span className="num-mono">{(session.distanceM / 1000).toFixed(2)} km</span>
                  {session.elevationGain != null && session.elevationGain > 0 && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="num-mono">↑{fmtInt(session.elevationGain)} m</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {session.isStitched && (
                    <Pill tone="activity" size="sm">
                      <Glyph name="GitMerge" size={10} className="mr-1" />
                      Stitched
                    </Pill>
                  )}
                  {session.reclassifiedAny && (
                    <Pill tone="neutral" size="sm">auto-klassifiziert</Pill>
                  )}
                  {gpx && (
                    <Pill tone="neutral" size="sm">{fmtInt(gpx.points.length)} Trackpunkte</Pill>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-[var(--color-border)]">
              <Stat label="Kalorien" value={fmtInt(session.calories)} unit="kcal" />
              <Stat label="Schritte" value={fmtInt(session.steps)} />
              <Stat label="HR max" value={session.hrMax ?? "—"} unit="bpm" />
              <Stat label="Spanne" value={fmtDuration(session.spanSec)} />
            </div>
          </CardBody>
        </Card>
      </FadeRise>

      {recoveryHours != null && recoveryHours > 0 && (
        <Section eyebrow="Erholung" title={`${Math.round(recoveryHours)} h empfohlen`}>
          <Card variant="soft">
            <CardBody className="p-5 flex items-center gap-3">
              <span className="grid place-items-center size-10 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-heart)] shrink-0">
                <Glyph name="Gauge" size={18} />
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-body">
                  Bis <span className="num-mono">{recoveryUntilDate ? fmtRecoveryUntil(recoveryUntilDate) : ""}</span> leichte Bewegung.
                </span>
                <span className="text-caption text-subtle">
                  Vorgabe vom Gerät · {Math.round(recoveryHours)} h ab Trainingsende.
                </span>
              </div>
            </CardBody>
          </Card>
        </Section>
      )}

      {trackPoints.length >= 2 && (
        <Section
          eyebrow="GPS · stitched"
          title={
            gpx
              ? `Track · ${(gpx.distanceM / 1000).toFixed(2)} km · ↑${gpx.ascentM} m / ↓${gpx.descentM} m`
              : `${trackPoints.length} Punkte`
          }
        >
          <Card>
            <CardBody className="p-0 overflow-hidden">
              <GpsMapClient
                points={trackPoints}
                elevations={gpx ? gpx.points.map((p) => p.ele) : []}
                tone="activity"
                height={460}
              />
            </CardBody>
          </Card>
          {session.gpxPaths.length > 1 && (
            <p className="text-caption text-subtle mt-2">
              Track aus {session.gpxPaths.length} GPX-Dateien zusammengesetzt — Lücken zwischen Segmenten werden visuell übersprungen.
            </p>
          )}
        </Section>
      )}

      {trackPoints.length < 2 && session.gpxPaths.length > 0 && (
        <Section eyebrow="GPS" title="Track auf dem Telefon">
          <Card variant="soft">
            <CardBody className="p-5 flex flex-col gap-2 text-caption">
              <div className="flex items-center gap-3">
                <Glyph name="Compass" size={16} className="text-subtle" />
                <span>
                  GPX-Dateien existieren in Gadgetbridge, sind aber noch nicht in
                  <code className="num-mono mx-1">$PULSE_ROOT/Gadgetbridge/files/</code>
                  synchronisiert.
                </span>
              </div>
              {session.gpxPaths.map((p) => (
                <code key={p} className="text-[0.8125rem] num-mono text-subtle truncate block">{p}</code>
              ))}
            </CardBody>
          </Card>
        </Section>
      )}

      <Section eyebrow="Segmente" title={`${session.members.length} Workouts`}>
        <Card>
          <CardBody className="p-0">
            <ol className="divide-y divide-[var(--color-border)]">
              {session.members.map((m, i) => {
                const next = session.members[i + 1];
                const gap = next ? next.startTs - m.endTs : null;
                return (
                  <li key={m.id}>
                    <Link
                      href={`/workouts/${m.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface)]/50 text-caption"
                    >
                      <span className="num-mono text-faint w-7">#{i + 1}</span>
                      <span className="num-mono w-24">{fmtTime(m.startTs)}</span>
                      <span className="num-mono w-20">{fmtDuration(m.durationSec)}</span>
                      <span className="num-mono w-24 text-right">{(m.distanceM / 1000).toFixed(2)} km</span>
                      <span className="num-mono w-24 text-right text-subtle">
                        {m.elevationGain != null && m.elevationGain > 0 ? `↑${fmtInt(m.elevationGain)} m` : "—"}
                      </span>
                      {m.type !== session.type && (
                        <Pill tone="neutral" size="sm">{m.typeLabel}</Pill>
                      )}
                      {m.hasGpx && <Pill tone="neutral" size="sm">GPX</Pill>}
                      <Glyph name="ChevronRight" size={12} className="ml-auto text-faint" />
                    </Link>
                    {gap != null && gap > 0 && (
                      <div className="px-5 pb-2 num-mono text-[10px] text-faint">
                        Pause {Math.round(gap / 60)} min
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function fmtDt(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleString("de-DE", {
    weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
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

function fmtRecoveryUntil(date: Date): string {
  return date.toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

