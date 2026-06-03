"use client";

import { Pill } from "@/components/ui/pill";
import { AbstainNote } from "./_AbstainNote";
import { ProseBody } from "./_ProseBody";
import type {
  EveningReviewPayload,
  LoadAssessment,
} from "@/runner/v4/slots/evening-review/types.ts";

const loadTone: Record<LoadAssessment, Parameters<typeof Pill>[0]["tone"]> = {
  light: "up",
  moderate: "activity",
  hard: "steady",
  max: "s1",
  no_workout: "neutral",
};

const loadLabel: Record<LoadAssessment, string> = {
  light: "leicht",
  moderate: "moderat",
  hard: "hart",
  max: "Maximum",
  no_workout: "kein Training",
};

export function EveningReviewBody({ payload }: { payload: EveningReviewPayload }) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const wi = payload.workout_impact;
  const wd = payload.wind_down_suggestion;
  return (
    <ProseBody
      headline={payload.headline}
      summary_short={payload.summary_short}
      summary_long={payload.summary_long}
      paragraphs={[{ label: "Tag bisher", text: payload.day_so_far }]}
      kpis={payload.kpis}
      confidence={payload.confidence?.value}
      domain="activity"
      extras={
        <div className="flex flex-col gap-2">
          {wi ? (
            <div className="flex items-center gap-2 text-xs">
              <Pill tone={loadTone[wi.load_assessment]} size="sm">
                {loadLabel[wi.load_assessment]}
              </Pill>
              <span className="text-[var(--color-text-muted)]">{wi.recovery_hint}</span>
            </div>
          ) : null}
          {wd ? (
            <div className="rounded-md bg-[var(--color-surface-soft)] p-2 text-xs">
              <div className="font-medium text-[var(--color-text)]">{wd.tiny}</div>
              <div className="text-[var(--color-text-muted)]">
                {wd.anchor} · {wd.why}
              </div>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
