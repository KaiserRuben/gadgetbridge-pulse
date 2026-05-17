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

export type PushTopic =
  | "morning_recap"
  | "post_workout"
  | "evening_brief"
  | "verdict_shift"
  | "contradiction"
  | "test";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  topic: PushTopic;
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

  await Promise.all(
    subs.map(async (sub: PushSubscriptionRecord) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webPush.sendNotification(subscription, JSON.stringify(payload), {
          TTL: 60 * 60, // 1h — payload represents a moment in time, drop if undelivered
        });
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
