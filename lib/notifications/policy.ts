import "server-only";

import { listSubscriptions } from "../push/subscriptions";
import { countSentSince, hasRecentDedupe } from "./log";
import { readPushPrefs } from "./prefs";
import type {
  NotifyIntent,
  NotifyPriority,
  RenderedPush,
  SuppressionReason,
} from "./types";

/**
 * Policy gate. Returns a verdict — either "send", or "suppress" with reason.
 *
 * Order matters: cheapest rejections first, expensive last. Each rule below
 * is a deliberate UX commitment (see chat design doc).
 */

export type Verdict =
  | { send: true }
  | { send: false; reason: SuppressionReason };

const DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1h
const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Quiet hours: high-priority bypasses always. Otherwise, if user has not
 * overridden, we use a conservative default range (22:00–07:00 local Europe/
 * Berlin). The original design called for inferring from sleep data, but
 * that lookup needs Gadgetbridge query glue we shouldn't add inline here —
 * a follow-up can wire `lib/queries/sleep-window.ts` once it's stable.
 */
const DEFAULT_QUIET_START = "22:00";
const DEFAULT_QUIET_END = "07:00";

function nowInBerlinHHMM(): string {
  // Europe/Berlin is the canonical "today" zone for Pulse (see CLAUDE.md).
  // Intl handles DST automatically.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date());
}

function isWithinQuietHours(start: string, end: string, nowHHMM: string): boolean {
  // Both inclusive, supports overnight ranges (e.g. 22:00–07:00).
  if (start === end) return false;
  if (start < end) {
    return nowHHMM >= start && nowHHMM < end;
  }
  // overnight: e.g. 22:00 → 07:00
  return nowHHMM >= start || nowHHMM < end;
}

export function gate(
  intent: NotifyIntent,
  rendered: RenderedPush,
): Verdict {
  const prefs = readPushPrefs();

  if (!prefs.enabled) {
    return { send: false, reason: "topic_off" };
  }

  if (!prefs.topics[rendered.topic]) {
    return { send: false, reason: "topic_off" };
  }

  // No subscriptions → nothing to do. Suppress silently (the user simply
  // hasn't consented yet; this is not an error).
  if (listSubscriptions().length === 0) {
    return { send: false, reason: "no_subscriptions" };
  }

  if (hasRecentDedupe(rendered.dedupeKey, DEDUPE_WINDOW_MS)) {
    return { send: false, reason: "dedup" };
  }

  const priority: NotifyPriority = rendered.priority ?? intent.priority ?? "normal";

  if (priority !== "high") {
    const start = prefs.quietStart ?? DEFAULT_QUIET_START;
    const end = prefs.quietEnd ?? DEFAULT_QUIET_END;
    if (isWithinQuietHours(start, end, nowInBerlinHHMM())) {
      return { send: false, reason: "quiet_hours" };
    }
  }

  if (priority !== "high") {
    const sentInWindow = countSentSince(BUDGET_WINDOW_MS);
    if (sentInWindow >= prefs.budgetPerDay) {
      return { send: false, reason: "budget" };
    }
  }

  return { send: true };
}

/** Exported for the settings UI counter ("Heute: X/4"). */
export function counters(): { sent24h: number; budget: number } {
  const prefs = readPushPrefs();
  return { sent24h: countSentSince(BUDGET_WINDOW_MS), budget: prefs.budgetPerDay };
}
