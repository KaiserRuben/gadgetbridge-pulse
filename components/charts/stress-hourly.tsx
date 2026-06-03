"use client";

import { STRESS_BUCKETS, stressBucket } from "@/lib/constants";

/**
 * 24-bar hourly stress histogram. One bar per hour (0..23). `null` entries
 * render as a faint placeholder ("no data"); numeric entries are colored by
 * the stress bucket they fall into (Entspannt/Leicht/Moderat/Hoch).
 *
 * Lifted out of `app/(app)/stress/[date]/page.tsx` so the v4 midday-check
 * drill body can render the same chart from its payload's `stress_hourly`
 * pass-through telemetry. Keeps both surfaces aligned without duplicating
 * the bar-render math.
 *
 * Mobile-first: the row is height-bounded by the parent (`height` prop);
 * defaults to 96 to fit drill bodies on a 390-wide viewport.
 */
export function StressHourly({
  values,
  height = 96,
}: {
  /** 24 entries (hours 0..23). `null` = no data this hour. */
  values: (number | null)[];
  /** Bar-stack height in px. */
  height?: number;
}) {
  const hourly = values.length === 24 ? values : new Array<number | null>(24).fill(null);
  const hasData = hourly.some((v) => v != null);
  if (!hasData) {
    return (
      <div
        className="grid place-items-center text-caption text-subtle rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/30"
        style={{ height }}
      >
        Stundenprofil noch nicht verfügbar.
      </div>
    );
  }
  const peak = Math.max(20, ...hourly.filter((v): v is number => v != null));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-1" style={{ height }}>
        {hourly.map((v, h) => {
          const pct = v != null ? Math.max(4, (v / peak) * 100) : 2;
          const bucket = v != null ? stressBucket(v) : STRESS_BUCKETS[0];
          return (
            <div key={h} className="flex-1 h-full flex flex-col-reverse items-center">
              <div
                className="w-full rounded-sm"
                style={{
                  height: `${pct}%`,
                  backgroundColor: v != null ? bucket.color : "var(--color-border)",
                  opacity: v != null ? 1 : 0.3,
                }}
                title={v != null ? `${h}:00 — ${v.toFixed(0)}` : `${h}:00 — keine Daten`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[0.625rem] num-mono text-faint">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}
