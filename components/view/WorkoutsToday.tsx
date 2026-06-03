"use client";

import Link from "next/link";

import { useViewState } from "@/lib/view-state/context";
import type { KpiWorkout } from "@/runner/v4/types.ts";

/**
 * Today's recorded workouts as a compact chip strip. tier1.kpis_today.workouts
 * is always generated but had no home render target — this surfaces it on
 * workout days only (renders nothing otherwise) and drills into the activity
 * page where the full sessions live.
 */
export function WorkoutsToday() {
  const { view, period_key } = useViewState();
  const workouts = view?.tier1?.kpis_today?.workouts ?? [];
  if (workouts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow shrink-0">Heute trainiert</span>
      {workouts.map((w, i) => (
        <Link
          key={`${w.ts_start_iso}-${i}`}
          href={`/activity/${period_key}`}
          className="group inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-3 py-1.5 text-[0.8125rem] ring-1 ring-inset ring-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: "var(--color-activity)" }}
          />
          <span className="font-medium text-[var(--color-text)]">{w.name ?? "Training"}</span>
          <span className="num-mono text-[var(--color-text-subtle)]">{summarize(w)}</span>
        </Link>
      ))}
    </div>
  );
}

function summarize(w: KpiWorkout): string {
  const parts: string[] = [`${Math.round(w.duration_min)} min`];
  if (w.distance_m != null && w.distance_m > 0) {
    parts.push(
      `${(w.distance_m / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`,
    );
  }
  if (w.active_kcal != null && w.active_kcal > 0) {
    parts.push(`${Math.round(w.active_kcal)} kcal`);
  }
  if (w.workout_load != null && w.workout_load > 0) {
    parts.push(`Last ${Math.round(w.workout_load)}`);
  }
  return parts.join(" · ");
}
