import "server-only";

import { notify } from "@/lib/notifications/notifier";
import type { NotifyIntent } from "@/lib/notifications/types";
import type { SlotEntry, SlotId } from "@/runner/v4/types.ts";

import { V4_SLOT_NOTIFY_POLICY, type SlotNotifyPolicy } from "./v4-slot-policy";

const READY_STATUSES = new Set<SlotEntry["status"]>([
  "fresh",
  "aging",
  "stale",
  "degraded",
  "abstained",
]);

const TITLE_MAX = 40;
const BODY_MAX = 90;
const FORBIDDEN = /[!\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function passesGuard(s: string, max: number): boolean {
  if (!s) return false;
  if (s.length > max) return false;
  if (FORBIDDEN.test(s)) return false;
  return true;
}

function extractBody(
  payload: unknown,
  keys: ReadonlyArray<string>,
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && passesGuard(v, BODY_MAX)) return v;
  }
  return null;
}

function shouldFire(
  policy: SlotNotifyPolicy,
  prior: SlotEntry | null,
  next: SlotEntry,
): boolean {
  const trigger =
    (next.status === "fresh" && policy.onFresh) ||
    (next.status === "abstained" && policy.onAbstained);
  if (!trigger) return false;
  if (prior == null) return true;
  if (READY_STATUSES.has(prior.status)) return false;
  return true;
}

function buildUrl(
  scope: "daily" | "weekly",
  period_key: string,
  slot_id: SlotId,
): string {
  if (scope === "weekly") return `/week/${period_key}#week_synthesis`;
  return `/day/${period_key}#${slot_id}`;
}

function buildDedupeKey(
  slot_id: SlotId,
  period_key: string,
  event_id: string | null,
): string {
  return event_id
    ? `v4-slot:${slot_id}:${event_id}`
    : `v4-slot:${slot_id}:${period_key}`;
}

export async function maybeNotifySlotTransition(
  scope: "daily" | "weekly",
  period_key: string,
  slot_id: SlotId,
  event_id: string | null,
  prior_entry: SlotEntry | null,
  new_entry: SlotEntry,
): Promise<void> {
  const policy = V4_SLOT_NOTIFY_POLICY[slot_id];
  if (!policy) return;

  if (!shouldFire(policy, prior_entry, new_entry)) return;

  const title = passesGuard(policy.titleDe, TITLE_MAX)
    ? policy.titleDe
    : policy.titleDe.slice(0, TITLE_MAX);
  const body =
    extractBody(new_entry.payload, policy.payloadBodyKeys) ?? policy.titleDe;
  const url = buildUrl(scope, period_key, slot_id);
  const dedupeKey = buildDedupeKey(slot_id, period_key, event_id);

  const intent: NotifyIntent = {
    topic: policy.topic,
    periodKey: period_key,
    priority: policy.priority,
    url,
    dedupeKey,
    hint: {
      topic: policy.topic,
      title,
      body: body.length > BODY_MAX ? body.slice(0, BODY_MAX) : body,
      url,
      dedupeKey,
      priority: policy.priority,
    },
  };

  try {
    const res = await notify(intent);
    if (!res.ok) {
      console.error(
        `[v4-push] dispatch failed slot_id=${slot_id} period_key=${period_key} err=${res.error}`,
      );
      return;
    }
    if (res.result === "sent") {
      console.log(
        `[v4-push] sent slot_id=${slot_id} period_key=${period_key} sent=${res.sent} pruned=${res.pruned} failed=${res.failed}`,
      );
    } else {
      console.log(
        `[v4-push] suppressed slot_id=${slot_id} period_key=${period_key} reason=${res.reason}`,
      );
    }
  } catch (err) {
    console.error(
      `[v4-push] dispatch failed slot_id=${slot_id} period_key=${period_key} err=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
