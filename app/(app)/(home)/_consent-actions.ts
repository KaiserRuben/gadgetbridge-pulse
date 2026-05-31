"use server";

import { revalidatePath } from "next/cache";

import { setConsentState } from "@/lib/notifications/consent";

/**
 * Consent-card actions live in the home route so the card itself only
 * needs a client component (no separate API surface). The state machine
 * lives in lib/notifications/consent.ts.
 *
 * SOFT_ACCEPTED: user tapped "Erlauben" — the client follows up with
 *   the real OS permission prompt. Once granted, /api/push/subscribe
 *   lands a subscription, which the UI reads next render and the page
 *   stops showing the card.
 *
 * SOFT_DECLINED: user tapped "Später" — the state machine backoffs the
 *   re-show by 7 days (see consent.ts shouldShowSoftCard).
 */

export async function acceptSoftConsent(): Promise<void> {
  setConsentState("SOFT_ACCEPTED");
  revalidatePath("/");
}

export async function declineSoftConsent(): Promise<void> {
  setConsentState("SOFT_DECLINED");
  revalidatePath("/");
}
