import { Pill } from "@/components/ui/pill";
import type { SlotStatus } from "@/runner/v4/types.ts";

const labels: Record<SlotStatus, string> = {
  scheduled: "geplant",
  computing: "läuft",
  fresh: "frisch",
  aging: "altert",
  stale: "veraltet",
  missed: "verpasst",
  errored: "Fehler",
  abstained: "ausgesetzt",
  degraded: "unvollständig",
};

const tones: Record<SlotStatus, Parameters<typeof Pill>[0]["tone"]> = {
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

export function SlotStatusPill({
  status,
  size = "sm",
  className,
}: {
  status: SlotStatus;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <Pill tone={tones[status]} size={size} className={className}>
      {labels[status]}
    </Pill>
  );
}
