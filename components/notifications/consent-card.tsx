"use client";

import { useTransition, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/cn";

interface Props {
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
}

/**
 * Soft consent card — appears on the home page only when:
 *   1. Engagement gate passed (≥1 finalized day + ≥1 classified meal)
 *   2. Consent state is ELIGIBLE_SOFT or (SOFT_DECLINED past backoff)
 *
 * The actual OS permission prompt fires from the embedded "Erlauben"
 * action via PushSubscribe-style flow on the *next* navigation — this
 * card only flips the consent state, not the browser permission. The
 * two-stage flow is intentional: we get one OS prompt per origin per
 * lifetime in some browsers, so we use the soft step to filter people
 * who would have declined.
 */
export function ConsentCard({ onAccept, onDecline }: Props) {
  const [pending, start] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleAccept = () => {
    if (pending) return;
    // CRITICAL: Notification.requestPermission() must run inside the
    // synchronous user-gesture handler — Chrome/Firefox/Safari all require
    // the activation flag, which is consumed by any awaited microtask
    // chain. So we fire the OS prompt first (before the server-action
    // round-trip) and then upgrade the consent state.
    void requestPushPermission();
    start(() => {
      void onAccept();
    });
  };

  const handleDecline = () => {
    if (pending) return;
    start(() => {
      void onDecline().then(() => setDismissed(true));
    });
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border/60 bg-background/60 p-5",
        "shadow-sm",
      )}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[0.9375rem] font-medium">
          Pulse kann dich kurz informieren
        </span>
        <span className="text-body-sm text-muted">
          Sobald dein Tag fertig analysiert ist, ein Workout abgeschlossen
          oder eine Mahlzeit erkannt wurde — eine kurze Notiz, keine
          Aufforderung. Du kannst jederzeit{" "}
          <Link
            href="/settings/notifications"
            className="underline hover:no-underline"
          >
            granular einstellen
          </Link>
          , welche Ereignisse durchkommen.
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleAccept}
          disabled={pending}
          className="px-3 py-2 rounded-md bg-foreground text-background text-body-sm font-medium disabled:opacity-60"
        >
          Erlauben
        </button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={pending}
          className="px-3 py-2 rounded-md text-body-sm text-muted underline hover:no-underline disabled:opacity-60"
        >
          Später
        </button>
      </div>
    </div>
  );
}

async function requestPushPermission(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch (err) {
    console.warn("[consent-card] subscribe failed", err);
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
