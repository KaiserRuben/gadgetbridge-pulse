import "server-only";

import { listRecent, type PushLogRow } from "@/lib/notifications/log";
import { counters } from "@/lib/notifications/policy";
import { readPushPrefs, type PushPrefs } from "@/lib/notifications/prefs";
import { readConsentState, type ConsentState } from "@/lib/notifications/consent";

export interface NotificationsSettingsData {
  prefs: PushPrefs;
  consent: ConsentState;
  counters: { sent24h: number; budget: number };
  history: PushLogRow[];
}

export function readNotificationsSettings(): NotificationsSettingsData {
  return {
    prefs: readPushPrefs(),
    consent: readConsentState(),
    counters: counters(),
    history: listRecent(20),
  };
}

export type { PushLogRow };
