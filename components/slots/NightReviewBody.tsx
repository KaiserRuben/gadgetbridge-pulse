"use client";

import { AbstainNote } from "./_AbstainNote";
import { ProseBody } from "./_ProseBody";
import type { NightReviewPayload } from "@/runner/v4/slots/night-review/types.ts";

export function NightReviewBody({ payload }: { payload: NightReviewPayload }) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  return (
    <ProseBody
      headline={payload.headline}
      summary_short={payload.summary_short}
      summary_long={payload.summary_long}
      paragraphs={[
        { label: "Heute", text: payload.analysis_today },
        { label: "Kontext", text: payload.analysis_context },
      ]}
      kpis={payload.kpis}
      suggestions={payload.suggestions_today.map((s) => ({
        anchor: s.anchor,
        tiny: s.tiny,
        why: s.why,
      }))}
    />
  );
}
