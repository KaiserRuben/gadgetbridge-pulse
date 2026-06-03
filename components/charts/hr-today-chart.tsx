"use client";

import { useMemo } from "react";
import { Timeline, type TimelinePoint } from "./timeline";
import { HR_ZONES } from "@/lib/constants";
import { fmtInt } from "@/lib/format";
import type {
  EveningHrBucket,
  EveningHrZoneMinute,
} from "@/runner/v4/slots/evening-review/types.ts";

/**
 * Composite chart: 24h heart-rate area + zone-minutes horizontal bars.
 *
 * Adapter for v4 drill bodies — converts the evening_review payload's
 * `hr_today` (5-min buckets) into `<Timeline>`'s `TimelinePoint[]`, and
 * renders the zone breakdown as a stacked-row mini-chart matching the
 * legacy `/heart` page layout. Lives in one component so the drill body
 * stays declarative and so future HR surfaces (post_workout, day_synthesis
 * drill) can reuse the same rendering.
 */
export function HrTodayChart({
  buckets,
  zoneMinutes,
  height = 220,
}: {
  buckets: ReadonlyArray<EveningHrBucket>;
  zoneMinutes: ReadonlyArray<EveningHrZoneMinute>;
  /** Timeline area height in px. Bars row is fixed-height below. */
  height?: number;
}) {
  const points: TimelinePoint[] = useMemo(() => {
    return buckets
      .map((b) => {
        const ts = Date.parse(b.ts_iso);
        if (!Number.isFinite(ts) || !Number.isFinite(b.bpm_mean)) return null;
        return { ts, v: b.bpm_mean };
      })
      .filter((p): p is TimelinePoint => p !== null);
  }, [buckets]);

  const totalMin = zoneMinutes.reduce((s, z) => s + z.minutes, 0) || 1;
  // Order zone-minutes by HR_ZONES so the colors line up regardless of
  // payload ordering. Zones not present in the payload render with 0.
  const orderedZones = HR_ZONES.map((z) => {
    const match = zoneMinutes.find((m) => m.label === z.label);
    return { zone: z, minutes: match?.minutes ?? 0 };
  });

  return (
    <div className="flex flex-col gap-3">
      <Timeline
        data={points}
        tone="heart"
        unit="bpm"
        height={height}
        bands={HR_ZONES.map((z) => ({ from: z.min, to: z.max, color: z.color }))}
      />
      {totalMin > 1 && (
        <div className="flex flex-col gap-1.5">
          {orderedZones.map(({ zone, minutes }) => {
            const pct = (minutes / totalMin) * 100;
            return (
              <div key={zone.label} className="flex items-center gap-2 sm:gap-3">
                <span className="w-14 sm:w-[80px] text-[0.6875rem] sm:text-[0.75rem] truncate">
                  {zone.label}
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--color-bg-elevated)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: zone.color }}
                  />
                </div>
                <span className="num-mono text-[0.6875rem] text-subtle w-10 sm:w-12 text-right shrink-0">
                  {fmtInt(minutes)}m
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
