"use client";

import type { ReactNode } from "react";

import type { SlotId } from "@/runner/v4/types.ts";
import { NightReviewBody } from "./NightReviewBody";
import { MorningBriefingBody } from "./MorningBriefingBody";
import { MiddayCheckBody } from "./MiddayCheckBody";
import { EveningReviewBody } from "./EveningReviewBody";
import { DaySynthesisBody } from "./DaySynthesisBody";
import { WeekSynthesisBody } from "./WeekSynthesisBody";
import type { NightReviewPayload } from "@/runner/v4/slots/night-review/types.ts";
import type { MorningBriefingPayload } from "@/runner/v4/slots/morning-briefing/types.ts";
import type { MiddayCheckPayload } from "@/runner/v4/slots/midday-check/types.ts";
import type { EveningReviewPayload } from "@/runner/v4/slots/evening-review/types.ts";
import type { DaySynthesisPayload } from "@/runner/v4/slots/day-synthesis/types.ts";
import type { WeekSynthesisPayload } from "@/runner/v4/slots/week-synthesis/types.ts";

type BodyComponent = (props: { payload: unknown }) => ReactNode;

const REGISTRY: Partial<Record<SlotId, BodyComponent>> = {
  night_review: ({ payload }) => (
    <NightReviewBody payload={payload as NightReviewPayload} />
  ),
  morning_briefing: ({ payload }) => (
    <MorningBriefingBody payload={payload as MorningBriefingPayload} />
  ),
  midday_check: ({ payload }) => (
    <MiddayCheckBody payload={payload as MiddayCheckPayload} />
  ),
  evening_review: ({ payload }) => (
    <EveningReviewBody payload={payload as EveningReviewPayload} />
  ),
  day_synthesis: ({ payload }) => (
    <DaySynthesisBody payload={payload as DaySynthesisPayload} />
  ),
  week_synthesis: ({ payload }) => (
    <WeekSynthesisBody payload={payload as WeekSynthesisPayload} />
  ),
};

export function renderCompactBody(slot_id: SlotId, payload: unknown): ReactNode {
  const Body = REGISTRY[slot_id];
  if (!Body) return null;
  return <Body payload={payload} />;
}
