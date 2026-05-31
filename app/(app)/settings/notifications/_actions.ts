"use server";

import { revalidatePath } from "next/cache";

import { setConsentState } from "@/lib/notifications/consent";
import {
  setBudgetPerDay,
  setEnabled,
  setQuietHours,
  setTopicEnabled,
} from "@/lib/notifications/prefs";
import type { NotifyTopic } from "@/lib/notifications/types";
import { notify as notifyDispatch } from "@/lib/notifications/notifier";

export async function toggleTopic(
  topic: NotifyTopic,
  enabled: boolean,
): Promise<void> {
  setTopicEnabled(topic, enabled);
  revalidatePath("/settings/notifications");
}

export async function toggleMaster(enabled: boolean): Promise<void> {
  setEnabled(enabled);
  revalidatePath("/settings/notifications");
}

export async function updateBudget(n: number): Promise<void> {
  setBudgetPerDay(n);
  revalidatePath("/settings/notifications");
}

export async function updateQuietHours(
  start: string | null,
  end: string | null,
): Promise<void> {
  setQuietHours(start, end);
  revalidatePath("/settings/notifications");
}

/**
 * Send a synthetic notification of the given topic so the user can
 * confirm permission/subscription is healthy and gauge the tone. The
 * full policy gate still applies — if the topic is off, the test
 * suppresses (and the history table will show why).
 */
export async function sendTestNotify(topic: NotifyTopic): Promise<void> {
  await notifyDispatch({
    topic,
    periodKey: new Date().toISOString().slice(0, 10),
    context: { name: "Test", kcal: 0, protein_g: 0, headline: "Test-Benachrichtigung" },
    dedupeKey: `test:${topic}:${Date.now()}`,
    priority: "normal",
  });
  revalidatePath("/settings/notifications");
}

export async function revokeConsent(): Promise<void> {
  setConsentState("REVOKED");
  revalidatePath("/settings/notifications");
  revalidatePath("/");
}
