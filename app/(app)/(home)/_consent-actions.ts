"use server";

import { revalidatePath } from "next/cache";

import { setConsentState } from "@/lib/notifications/consent";

/**
 * Consent-card actions. Co-located under the legacy `(home)` route group for
 * historical reasons; consumed by `/v4` (the active home surface). Keep the
 * path stable until the consent card moves to its own route.
 *
 * SOFT_ACCEPTED: user tapped "Erlauben" — the client follows up with the real
 *   OS permission prompt. Once granted, /api/push/subscribe lands a
 *   subscription, which the UI reads next render and the page stops showing
 *   the card.
 *
 * SOFT_DECLINED: user tapped "Später" — the state machine backoffs the
 *   re-show by 7 days (see consent.ts shouldShowSoftCard).
 */

export async function acceptSoftConsent(): Promise<void> {
  setConsentState("SOFT_ACCEPTED");
  revalidatePath("/v4");
}

export async function declineSoftConsent(): Promise<void> {
  setConsentState("SOFT_DECLINED");
  revalidatePath("/v4");
}
