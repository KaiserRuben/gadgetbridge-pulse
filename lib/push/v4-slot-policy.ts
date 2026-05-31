import "server-only";

import type { SlotId } from "@/runner/v4/types.ts";
import type { NotifyPriority, NotifyTopic } from "@/lib/notifications/types";

export interface SlotNotifyPolicy {
  titleDe: string;
  topic: NotifyTopic;
  priority: NotifyPriority;
  onFresh: boolean;
  onAbstained: boolean;
  payloadBodyKeys: ReadonlyArray<string>;
}

const BODY_KEYS: ReadonlyArray<string> = ["headline", "summary_short"];

export const V4_SLOT_NOTIFY_POLICY: Readonly<
  Partial<Record<SlotId, SlotNotifyPolicy>>
> = Object.freeze({
  night_review: {
    titleDe: "Nacht-Review bereit",
    topic: "day_finalized",
    priority: "normal",
    onFresh: true,
    onAbstained: false,
    payloadBodyKeys: BODY_KEYS,
  },
  morning_briefing: {
    titleDe: "Morgen-Brief bereit",
    topic: "day_finalized",
    priority: "normal",
    onFresh: true,
    onAbstained: false,
    payloadBodyKeys: BODY_KEYS,
  },
  day_synthesis: {
    titleDe: "Tages-Synthese bereit",
    topic: "day_finalized",
    priority: "normal",
    onFresh: true,
    onAbstained: false,
    payloadBodyKeys: BODY_KEYS,
  },
  week_synthesis: {
    titleDe: "Wochen-Synthese bereit",
    topic: "day_finalized",
    priority: "normal",
    onFresh: true,
    onAbstained: false,
    payloadBodyKeys: BODY_KEYS,
  },
  post_workout: {
    titleDe: "Workout-Review bereit",
    topic: "workout_complete",
    priority: "normal",
    onFresh: true,
    onAbstained: false,
    payloadBodyKeys: BODY_KEYS,
  },
  anomaly_explain: {
    titleDe: "Anomalie-Erklärung bereit",
    topic: "safety_anomaly",
    priority: "high",
    onFresh: true,
    onAbstained: false,
    payloadBodyKeys: BODY_KEYS,
  },
});
