"use client";

import { AbstainNote } from "./_AbstainNote";
import { ProseBody } from "./_ProseBody";
import { TopAnchorsList } from "./_TopAnchorsList";
import type { DaySynthesisPayload } from "@/runner/v4/slots/day-synthesis/types.ts";

export function DaySynthesisBody({ payload }: { payload: DaySynthesisPayload }) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  return (
    <ProseBody
      headline={payload.headline}
      summary_short={payload.summary_short}
      summary_long={payload.summary_long}
      paragraphs={[
        { label: "Erzählung", text: payload.narrative },
        { label: "Morgen", text: payload.tomorrow_focus },
      ]}
      kpis={payload.kpis}
      confidence={payload.confidence?.value}
      extras={<TopAnchorsList anchors={payload.top_anchors} />}
    />
  );
}
