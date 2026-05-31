import "server-only";
import webPush from "web-push";
import { getVapidConfig } from "./vapid";
import {
  listSubscriptions,
  deleteSubscription,
  type PushSubscriptionRecord,
} from "./subscriptions";

let configured = false;
function configure(): void {
  if (configured) return;
  const c = getVapidConfig();
  webPush.setVapidDetails(c.subject, c.publicKey, c.privateKey);
  configured = true;
}

/**
 * Topic enum is the canonical PushTopic union for everything below the
 * notifier funnel. It mirrors lib/notifications/types.ts → NotifyTopic so
 * the two stay in lock-step; if a topic is added, both files need an entry.
 */
export type PushTopic =
  | "meal_classified"
  | "day_finalized"
  | "sleep_complete"
  | "workout_complete"
  | "pattern_detected"
  | "safety_anomaly"
  | "coach_quote"
  | "test";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  topic: PushTopic;
  /**
   * Service-worker `tag` (collapse-key). Repeat sends with the same tag
   * replace the previous notification instead of stacking. Defaults to
   * `topic` so each topic naturally collapses; the notifier passes its
   * stable `dedupeKey` so e.g. two "day_finalized" pushes for different
   * dates remain distinct.
   */
  tag?: string;
  /**
   * Web-push TTL in seconds. Default 3600 (1h). 0 = best-effort one-shot
   * (push services may drop immediately if device offline).
   */
  ttlSeconds?: number;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  pruned: number;
}

/**
 * Send a payload to every registered subscription. 4xx responses are pruned
 * (subscription expired/unsubscribed). 5xx are counted as failed but kept.
 */
export async function dispatch(payload: PushPayload): Promise<DispatchResult> {
  configure();
  const subs = listSubscriptions();
  let sent = 0;
  let failed = 0;
  let pruned = 0;

  // tag defaults to the topic so historical "morning_recap" etc. behaviour
  // is unchanged when callers don't pass a dedupe-keyed tag.
  const wireBody = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    topic: payload.topic,
    tag: payload.tag ?? payload.topic,
  });
  const ttl =
    typeof payload.ttlSeconds === "number" ? payload.ttlSeconds : 60 * 60;

  await Promise.all(
    subs.map(async (sub: PushSubscriptionRecord) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webPush.sendNotification(subscription, wireBody, { TTL: ttl });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          deleteSubscription(sub.endpoint);
          pruned++;
        } else {
          failed++;
          console.warn(
            `[push] dispatch failed endpoint=${sub.endpoint.slice(0, 40)}… status=${status}`,
          );
        }
      }
    }),
  );

  return { sent, failed, pruned };
}
