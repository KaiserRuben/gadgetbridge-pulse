"use client";

import { Pill } from "@/components/ui/pill";
import { useViewState } from "@/lib/view-state/context";
import type { PipelineHealth } from "@/runner/v4/types.ts";

const tones: Record<PipelineHealth, Parameters<typeof Pill>[0]["tone"]> = {
  ok: "up",
  degraded: "s2",
  stalled: "s1",
};

const labels: Record<PipelineHealth, string> = {
  ok: "live",
  degraded: "verzögert",
  stalled: "gestoppt",
};

export function PipelineHealthBadge({ className }: { className?: string }) {
  const { view, connected } = useViewState();
  const health = view?.meta?.pipeline_health ?? "stalled";
  const connSuffix = connected ? "" : " · offline";
  return (
    <Pill tone={tones[health]} size="sm" className={className}>
      pipeline {labels[health]}
      {connSuffix}
    </Pill>
  );
}
