import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { recoveryBandLabel, recoveryBandTone, type RecoveryView } from "@/lib/recovery";

/**
 * Compact recovery card for the home dashboard. Renders only when relevant
 * (band !== "ready" or recoveryHoursOpen > 0). Shows score, band pill, top
 * drivers and links to /coach for the full breakdown.
 */
export function RecoveryCard({
  view,
  href = "/coach",
}: {
  view: RecoveryView;
  href?: string;
}) {
  const tone = recoveryBandTone(view.band);
  const drivers = view.drivers.slice(0, 2);
  const glow =
    view.band === "fatigued" ? "heart" : view.band === "moderate" ? "stress" : undefined;

  return (
    <Link href={href} className="block">
      <Card hoverable glow={glow}>
        <CardBody className="p-4 md:p-5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Glyph name="Gauge" size={14} className="text-[var(--color-heart)]" />
              <Eyebrow>Erholung</Eyebrow>
            </div>
            <Pill tone={tone} size="sm">{recoveryBandLabel(view.band)}</Pill>
          </div>

          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="num text-[1.75rem] font-semibold leading-none tracking-[-0.02em]">
              {view.score}
            </span>
            <span className="text-subtle text-[0.75rem] num-mono">/100</span>
            {view.recoveryHoursOpen != null && view.recoveryHoursOpen > 0 && (
              <span className="text-caption num-mono ml-auto">
                {Math.round(view.recoveryHoursOpen)} h offen
              </span>
            )}
          </div>

          {drivers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {drivers.map((d, i) => (
                <Pill key={i} tone="neutral" size="sm" className="num-mono">
                  {d}
                </Pill>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </Link>
  );
}
