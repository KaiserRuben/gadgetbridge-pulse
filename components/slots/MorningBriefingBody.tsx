"use client";

import { Pill } from "@/components/ui/pill";
import { AbstainNote } from "./_AbstainNote";
import { ProseBody } from "./_ProseBody";
import type { MorningBriefingPayload } from "@/runner/v4/slots/morning-briefing/types.ts";

const planTone: Record<
  MorningBriefingPayload["plan_adherence"]["status"],
  Parameters<typeof Pill>[0]["tone"]
> = {
  proceed: "up",
  modify: "steady",
  skip: "down",
  no_plan: "neutral",
};

const planLabel: Record<MorningBriefingPayload["plan_adherence"]["status"], string> = {
  proceed: "Plan beibehalten",
  modify: "Plan anpassen",
  skip: "Plan auslassen",
  no_plan: "kein Plan",
};

export function MorningBriefingBody({ payload }: { payload: MorningBriefingPayload }) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const pa = payload.plan_adherence;
  return (
    <ProseBody
      headline={payload.headline}
      summary_short={payload.summary_short}
      summary_long={payload.summary_long}
      paragraphs={[{ label: "Fokus", text: payload.focus_today }]}
      suggestions={(payload.suggestions_today ?? []).map((s) => ({
        anchor: s.anchor,
        tiny: s.tiny,
        why: s.why,
      }))}
      confidence={payload.confidence?.value}
      domain="heart"
      extras={
        <div className="flex items-start gap-2 rounded-md bg-[var(--color-surface-soft)] p-2 text-xs">
          <Pill tone={planTone[pa.status]} size="sm">
            {planLabel[pa.status]}
          </Pill>
          <div className="min-w-0 flex-1">
            {pa.recommendation ? (
              <div className="font-medium text-[var(--color-text)]">{pa.recommendation}</div>
            ) : null}
            <div className="text-[var(--color-text-muted)]">{pa.reasoning}</div>
          </div>
        </div>
      }
    />
  );
}
