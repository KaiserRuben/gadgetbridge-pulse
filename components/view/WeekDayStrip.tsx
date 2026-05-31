import { WeekDayCard } from "./WeekDayCard";
import { weekDayDate } from "@/lib/week";
import type { ViewStateDaily } from "@/runner/v4/types.ts";

export function WeekDayStrip({
  weekKey,
  dailyViews,
}: {
  weekKey: string;
  dailyViews: Array<ViewStateDaily | null>;
}) {
  const dates = Array.from({ length: 7 }, (_, i) => weekDayDate(weekKey, i)!);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight text-[var(--color-text)]">
        Tage
      </h2>
      <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-7 md:gap-3 md:overflow-visible md:px-0">
        {dates.map((d, i) => (
          <WeekDayCard
            key={d}
            date={d}
            entry={dailyViews[i]?.slots.day_synthesis ?? null}
          />
        ))}
      </div>
    </section>
  );
}
