import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { loadRecoveryInsight, loadRecoveryPackage } from "@/lib/v3-loaders";

import { DomainChrome } from "@/components/domain/domain-chrome";
import { InsightSection } from "@/components/domain/insight-section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
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

  const [insight, pkg] = await Promise.all([
    loadRecoveryInsight(date),
    loadRecoveryPackage(date),
  ]);

  const hrvSeries =
    pkg?.today.hrv.hrv_series_today.map((p) => p.value_ms) ?? [];
  const last2 = pkg?.last_2_days ?? [];
  const days37 = pkg?.days_3_to_7 ?? [];
  const allDays = [...days37.reverse(), ...last2.reverse(), ...(pkg ? [{ date: pkg.meta.today_date, rmssd_ms: pkg.today.hrv.rmssd_sleep_ms }] : [])];
  const rmssdSeries = allDays.map((d) => d.rmssd_ms ?? null).filter((v): v is number => v != null);

  // Disambiguate stale abstain copy: if the day actually has HRV samples, the
  // banner shouldn't claim "keine HRV-Daten". Re-word to the more accurate
  // "kein RMSSD im Schlaffenster". Leave non-HRV abstain reasons alone.
  const displayInsight = insight && insight.abstain && hrvSeries.length > 0 && insight.abstain_reason?.toLowerCase().includes("hrv")
    ? { ...insight, abstain_reason: "kein RMSSD im Schlaffenster — Tagesserie unten verfügbar" }
    : insight;

  return (
    <div className="flex flex-col gap-8">
      <DomainChrome
        domainLabel="Erholung"
        date={date}
        hrefBase="/recovery"
        icon="HeartPulse"
      />

      <FadeRise>
        <InsightSection insight={displayInsight} domainLabel="Erholung" />
      </FadeRise>

      {/* ── HRV series today ────────────────────────────────────────────── */}
      {hrvSeries.length > 0 && (
        <FadeRise>
          <Card>
            <CardBody className="p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Eyebrow>HRV-Verlauf heute ({hrvSeries.length} Punkte)</Eyebrow>
                <span className="text-caption text-muted">
                  ms · letzte: {pkg?.today.hrv.latest_rmssd_ms ?? "—"}
                </span>
              </div>
              <Sparkline values={hrvSeries} tone="heart" width={600} height={120} />
            </CardBody>
          </Card>
        </FadeRise>
      )}

      {/* ── RMSSD trend last 7 days ─────────────────────────────────────── */}
      {rmssdSeries.length > 0 && (
        <FadeRise>
          <Card>
            <CardBody className="p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Eyebrow>RMSSD-Trend (7 Tage)</Eyebrow>
                <span className="text-caption text-muted">
                  ms · heute markiert
                </span>
              </div>
              <Sparkline values={rmssdSeries} tone="heart" width={600} height={120} />
            </CardBody>
          </Card>
        </FadeRise>
      )}

      {/* ── RHR drift + stress summary ──────────────────────────────────── */}
      {pkg && (
        <FadeRise>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Stat
              label="RHR-Drift"
              value={pkg.today.rhr.rhr_drift_bpm}
              unit="bpm"
              hint={
                pkg.today.rhr.rhr_drift_bpm != null && pkg.today.rhr.rhr_drift_bpm > 5
                  ? "sympathisch dominant"
                  : "gut erholt"
              }
            />
            <Stat
              label="Stress Mean"
              value={pkg.today.stress.mean}
              unit=""
              hint={
                pkg.today.stress.high_stress_min != null
                  ? `${pkg.today.stress.high_stress_min} min hoch`
                  : undefined
              }
            />
            <Stat
              label="SpO₂ min"
              value={pkg.today.spo2.min}
              unit="%"
              hint={
                pkg.today.spo2.mean != null
                  ? `Schnitt ${pkg.today.spo2.mean}%`
                  : undefined
              }
            />
          </div>
        </FadeRise>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: number | null;
  unit: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardBody className="p-4 flex flex-col gap-1">
        <Eyebrow>{label}</Eyebrow>
        <div className="flex items-baseline gap-2">
          <span className="num text-h2 font-semibold tabular-nums">
            {value != null ? value : "—"}
          </span>
          {unit && <span className="text-caption text-muted">{unit}</span>}
        </div>
        {hint && <span className="text-caption text-muted">{hint}</span>}
      </CardBody>
    </Card>
  );
}
