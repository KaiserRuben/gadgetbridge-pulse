"use client";

import type { ReactNode } from "react";

import type { SlotId } from "@/runner/v4/types.ts";
import { NightReviewDrillBody } from "./NightReviewDrillBody";
import { MorningBriefingDrillBody } from "./MorningBriefingDrillBody";
import { MiddayCheckDrillBody } from "./MiddayCheckDrillBody";
import { EveningReviewDrillBody } from "./EveningReviewDrillBody";
import { DaySynthesisDrillBody } from "./DaySynthesisDrillBody";
import { WeekSynthesisDrillBody } from "./WeekSynthesisDrillBody";
import { PostWorkoutDrillBody } from "./PostWorkoutDrillBody";
import { AnomalyExplainDrillBody } from "./AnomalyExplainDrillBody";
import type { NightReviewPayload } from "@/runner/v4/slots/night-review/types.ts";
import type { WeekSynthesisPayload } from "@/runner/v4/slots/week-synthesis/types.ts";
import type { MorningBriefingPayload } from "@/runner/v4/slots/morning-briefing/types.ts";
import type { MiddayCheckPayload } from "@/runner/v4/slots/midday-check/types.ts";
import type { EveningReviewPayload } from "@/runner/v4/slots/evening-review/types.ts";
import type { DaySynthesisPayload } from "@/runner/v4/slots/day-synthesis/types.ts";
import type { PostWorkoutPayload } from "@/runner/v4/slots/post-workout/types.ts";
import type { AnomalyExplainPayload } from "@/runner/v4/slots/anomaly-explain/types.ts";

type BodyComponent = (props: {
  payload: unknown;
  observation_id?: string;
}) => ReactNode;

const REGISTRY: Partial<Record<SlotId, BodyComponent>> = {
  night_review: ({ payload }) => (
    <NightReviewDrillBody payload={payload as NightReviewPayload} />
  ),
  morning_briefing: ({ payload }) => (
    <MorningBriefingDrillBody payload={payload as MorningBriefingPayload} />
  ),
  midday_check: ({ payload }) => (
    <MiddayCheckDrillBody payload={payload as MiddayCheckPayload} />
  ),
  evening_review: ({ payload }) => (
    <EveningReviewDrillBody payload={payload as EveningReviewPayload} />
  ),
  day_synthesis: ({ payload }) => (
    <DaySynthesisDrillBody payload={payload as DaySynthesisPayload} />
  ),
  week_synthesis: ({ payload }) => (
    <WeekSynthesisDrillBody payload={payload as WeekSynthesisPayload} />
  ),
  post_workout: ({ payload }) => (
    <PostWorkoutDrillBody payload={payload as PostWorkoutPayload} />
  ),
  anomaly_explain: ({ payload, observation_id }) => (
    <AnomalyExplainDrillBody
      payload={payload as AnomalyExplainPayload}
      observation_id={observation_id}
    />
  ),
};

export function renderDrillBody(
  slot_id: SlotId,
  payload: unknown,
  observation_id?: string,
): ReactNode {
  const Body = REGISTRY[slot_id];
  if (!Body) return null;
  return <Body payload={payload} observation_id={observation_id} />;
}
