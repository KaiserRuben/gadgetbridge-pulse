import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

import {
  getWorkoutById, getWorkoutData, getWorkoutSections, getCmfGpsSamples,
  workoutTypeIcon, type GpsPoint,
} from "@/lib/queries/workouts";
import { loadGpx, type GpxTrack } from "@/lib/queries/gpx";
import { fmtInt } from "@/lib/format";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";
import { Timeline, type TimelinePoint } from "@/components/charts/timeline";
import { GpsMap } from "@/components/charts/gps-map";

const RUN_PACE_LABELS = ["Z1 Erholung", "Z2 Aerob", "Z3 Tempo", "Z4 Schwelle", "Z5 Max"];

export default async function WorkoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const w = getWorkoutById(id);
  if (!w) notFound();

  const data = getWorkoutData(id);
  const sections = getWorkoutSections(id);

  // GPS resolution: try CMF DB first, then mirrored GPX file.
  const cmfGps: GpsPoint[] = (() => {
    try { return getCmfGpsSamples({ sinceSec: w.startTs, untilSec: w.endTs }); }
    catch { return []; }
  })();
  const gpx: GpxTrack | null = w.gpxPath ? await loadGpx(w.gpxPath) : null;
  const trackPoints = cmfGps.length >= 2
    ? cmfGps.map((p) => ({ lat: p.lat, lon: p.lon }))
    : gpx ? gpx.points.map((p) => ({ lat: p.lat, lon: p.lon })) : [];

  const hrSeries: TimelinePoint[] = data
    .filter((p) => p.hr != null)
    .map((p) => ({ ts: p.ts * 1000, v: p.hr! }));
  const avgHr = hrSeries.length > 0
    ? Math.round(hrSeries.reduce((s, p) => s + p.v, 0) / hrSeries.length)
    : null;
  const avgPaceSecPerKm = w.distanceM > 0 && w.durationSec > 0
    ? Math.round(w.durationSec / (w.distanceM / 1000))
    : null;
  const altitudeProfile: TimelinePoint[] = data
    .filter((p) => p.altitude != null && p.altitude !== 0)
    .map((p) => ({ ts: p.ts * 1000, v: p.altitude! }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <Link href="/workouts" className="flex items-center gap-1 text-caption text-muted hover:text-[var(--color-text)]">
          <Glyph name="ChevronRight" size={14} className="rotate-180" />
          Workouts
        </Link>
        <span className="num-mono text-caption">#{w.id}</span>
      </div>

      <FadeRise>
        <Card glow="activity">
          <CardBody className="p-5 lg:p-6 flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <span className="grid place-items-center size-14 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-activity)] shrink-0">
                <Glyph name={workoutTypeIcon(w.type) as GlyphName} size={24} />
              </span>
              <div className="flex flex-col gap-1.5 min-w-0">
                <Eyebrow>{fmtDt(w.startTs)}</Eyebrow>
                <h1 className="text-hero">{w.typeLabel}</h1>
                <div className="flex items-center gap-2 flex-wrap text-caption">
                  <span className="num-mono">{fmtDuration(w.durationSec)}</span>
                  <span className="text-faint">·</span>
                  <span className="num-mono">{(w.distanceM / 1000).toFixed(2)} km</span>
                  {avgPaceSecPerKm != null && w.type !== 3 && w.type !== 6 && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="num-mono">⌀ {fmtPace(avgPaceSecPerKm)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-[var(--color-border)]">
              <Stat label="Kalorien"   value={fmtInt(w.calories)} unit="kcal" />
              <Stat label="Schritte"   value={fmtInt(w.steps)} />
              <Stat label="HR ⌀"       value={avgHr ?? "—"} unit="bpm" />
              <Stat label="HR max"     value={w.hrMax ?? "—"} unit="bpm" />
            </div>
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="Trainingseffekt" title="Belastung & Erholung">
        <Card>
          <CardBody className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Last"        value={w.workoutLoad ?? "—"} />
            <Stat label="Aerob"       value={w.aerobicEffect ?? "—"} unit="/5" />
            <Stat label="Anaerob"     value={w.anaerobicEffect ?? "—"} unit="/5" />
            <Stat label="Erholung"    value={w.recoveryHours ?? "—"} unit="h" />
            {w.maxMet != null && <Stat label="Max MET"   value={w.maxMet} />}
            {w.elevationGain != null && <Stat label="Anstieg"   value={fmtInt(w.elevationGain)} unit="m" />}
            {w.elevationLoss != null && <Stat label="Gefälle"   value={fmtInt(w.elevationLoss)} unit="m" />}
            {w.trainingPoints != null && w.trainingPoints > 0 && (
              <Stat label="Punkte"   value={fmtInt(w.trainingPoints)} />
            )}
          </CardBody>
        </Card>
      </Section>

      {hrSeries.length > 1 && (
        <Section eyebrow="Verlauf" title="Herzfrequenz">
          <Card>
            <CardBody className="p-5">
              <Timeline data={hrSeries} tone="heart" unit="bpm" height={220} />
            </CardBody>
          </Card>
        </Section>
      )}

      {trackPoints.length >= 2 && (
        <Section
          eyebrow="GPS"
          title={`Track · ${gpx ? `${(gpx.distanceM / 1000).toFixed(2)} km` : `${trackPoints.length} Punkte`}${gpx ? ` · ↑${gpx.ascentM} m / ↓${gpx.descentM} m` : ""}`}
        >
          <Card>
            <CardBody className="p-0 overflow-hidden">
              <GpsMap
                points={trackPoints}
                elevations={gpx ? gpx.points.map((p) => p.ele) : []}
                tone="activity"
                height={420}
              />
            </CardBody>
          </Card>
        </Section>
      )}

      {trackPoints.length < 2 && altitudeProfile.length > 1 && (
        <Section eyebrow="Höhe" title="Profil">
          <Card variant="soft">
            <CardBody className="p-5">
              <Timeline data={altitudeProfile} tone="body" unit="m" height={140} />
            </CardBody>
          </Card>
        </Section>
      )}

      {trackPoints.length < 2 && w.hasGpx && (
        <Section eyebrow="GPS" title="Track auf dem Telefon">
          <Card variant="soft">
            <CardBody className="p-5 flex flex-col gap-2">
              <div className="flex items-center gap-3 text-caption">
                <Glyph name="Compass" size={16} className="text-subtle" />
                <span>
                  Gadgetbridge hat eine GPX-Datei aufgezeichnet, die noch nicht zum Server synchronisiert ist.
                </span>
              </div>
              <code className="text-[0.8125rem] num-mono text-subtle truncate">{w.gpxPath}</code>
              <span className="text-caption text-subtle">
                Zum Anzeigen: Gadgetbridge-Verzeichnis via Syncthing nach <code className="num-mono">$PULSE_ROOT/gpx/</code> spiegeln.
              </span>
            </CardBody>
          </Card>
        </Section>
      )}

      {w.paceZoneSeconds && (
        <Section eyebrow="Pace-Zonen" title="Zeit pro Zone">
          <Card variant="soft">
            <CardBody className="p-5 flex flex-col gap-2">
              {w.paceZoneSeconds.map((sec, i) => {
                const total = w.paceZoneSeconds!.reduce((a, b) => a + b, 0) || 1;
                const pct = (sec / total) * 100;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-[110px] text-[0.875rem]">{RUN_PACE_LABELS[i]}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden bg-[var(--color-bg-elevated)]">
                      <div className="h-full rounded-full" style={{
                        width: `${pct}%`,
                        background: paceZoneColor(i),
                      }} />
                    </div>
                    <span className="num-mono text-caption w-[64px] text-right">{fmtDuration(sec)}</span>
                    <span className="num-mono text-caption text-subtle w-[42px] text-right">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </Section>
      )}

      {sections.length > 0 && (
        <Section eyebrow="Sektionen" title={`${sections.length} Abschnitte`}>
          <Card>
            <CardBody className="p-5">
              <table className="w-full text-[0.875rem]">
                <thead>
                  <tr className="text-caption text-subtle border-b border-[var(--color-border)]">
                    <th className="text-left py-2">Nr.</th>
                    <th className="text-right py-2">Zeit</th>
                    <th className="text-right py-2">Distanz</th>
                    <th className="text-right py-2">Pace</th>
                    <th className="text-right py-2">HR</th>
                    <th className="text-right py-2">Kadenz</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((s) => (
                    <tr key={s.num} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="py-2 num-mono">{s.num}</td>
                      <td className="py-2 num-mono text-right">{fmtDuration(s.timeSec)}</td>
                      <td className="py-2 num-mono text-right">{(s.distanceM / 1000).toFixed(2)} km</td>
                      <td className="py-2 num-mono text-right">{s.paceSecPerKm != null ? fmtPace(s.paceSecPerKm) : "—"}</td>
                      <td className="py-2 num-mono text-right">{s.hr ?? "—"}</td>
                      <td className="py-2 num-mono text-right">{s.cadence ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </Section>
      )}

      {w.recoveryHours != null && w.recoveryHours > 0 && (
        <Section eyebrow="Empfehlung" title="Nächstes Training">
          <Card variant="soft">
            <CardBody className="p-5 flex items-center gap-3">
              <Glyph name="Repeat" size={16} className="text-[var(--color-activity)]" />
              <span className="text-[0.9375rem]">
                Vollständige Erholung in <Pill tone="activity" size="sm" className="num-mono">{w.recoveryHours} h</Pill>
                <span className="text-subtle"> — entspannt bis </span>
                <span className="num-mono">
                  {new Date((w.endTs + w.recoveryHours * 3600) * 1000)
                    .toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}
                </span>.
              </span>
            </CardBody>
          </Card>
        </Section>
      )}
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

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function paceZoneColor(zone: number): string {
  return zone === 0 ? "hsl(195 80% 60%)"
       : zone === 1 ? "hsl(150 70% 52%)"
       : zone === 2 ? "hsl(45 92% 60%)"
       : zone === 3 ? "hsl(28 92% 58%)"
       : "hsl(348 90% 60%)";
}
