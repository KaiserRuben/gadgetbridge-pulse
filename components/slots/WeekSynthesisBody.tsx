"use client";

import { AbstainNote } from "./_AbstainNote";
import { ProseBody } from "./_ProseBody";
import { TopAnchorsList } from "./_TopAnchorsList";
import type { WeekSynthesisPayload } from "@/runner/v4/slots/week-synthesis/types.ts";

export function WeekSynthesisBody({ payload }: { payload: WeekSynthesisPayload }) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  return (
    <ProseBody
      headline={payload.headline}
      summary_short={payload.summary_short}
      summary_long={payload.summary_long}
      paragraphs={[
        { label: "Woche", text: payload.week_narrative },
        { label: "Nächste Woche", text: payload.next_week_focus },
      ]}
      kpis={payload.kpis}
      confidence={payload.confidence?.value}
      domain="activity"
      extras={<TopAnchorsList anchors={payload.top_anchors} />}
    />
  );
}
