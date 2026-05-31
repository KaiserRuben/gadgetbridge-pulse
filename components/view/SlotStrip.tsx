"use client";

import { Pill } from "@/components/ui/pill";
import { useViewState } from "@/lib/view-state/context";
import type {
  DailySlotId,
  ViewStateDailySlots,
  SlotEntry,
  SlotStatus,
} from "@/runner/v4/types.ts";

/**
 * Compact horizontal strip of the five fixed daily slots so users can
 * scan pipeline progress at a glance. Each pip = status + scheduled_for.
 */

const ORDER: DailySlotId[] = [
  "night_review",
  "morning_briefing",
  "midday_check",
  "evening_review",
  "day_synthesis",
];

const SHORT_LABEL: Record<DailySlotId, string> = {
  night_review: "Nacht",
  morning_briefing: "Morgen",
  midday_check: "Mittag",
  evening_review: "Abend",
  day_synthesis: "Tag",
};

const PIP_TONE: Record<SlotStatus, Parameters<typeof Pill>[0]["tone"]> = {
  scheduled: "neutral",
  computing: "activity",
  fresh: "up",
  aging: "steady",
  stale: "down",
  missed: "low",
  errored: "s1",
  abstained: "neutral",
  degraded: "s2",
};

export function SlotStrip({ className }: { className?: string }) {
  const { view } = useViewState();
  if (!view || view.scope !== "daily") return null;

  const slots = view.slots as ViewStateDailySlots;
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5">
        {ORDER.map((id) => {
          const entry = slots[id] as SlotEntry | undefined;
          const status = entry?.status ?? "scheduled";
          return (
            <Pill key={id} tone={PIP_TONE[status]} size="sm">
              {SHORT_LABEL[id]}
            </Pill>
          );
        })}
      </div>
    </div>
  );
}
