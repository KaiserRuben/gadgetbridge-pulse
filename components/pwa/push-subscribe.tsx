"use client";

import { useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type Status =
  | "idle"
  | "unsupported"
  | "permission-default"
  | "permission-denied"
  | "subscribed"
  | "error";

/**
 * Settings/Profile component: opt into web-push notifications.
 *
 * Reads NEXT_PUBLIC_VAPID_PUBLIC_KEY at build time. On click:
 *   1. Request Notification permission
 *   2. Get push subscription from the existing service worker
 *   3. POST to /api/push/subscribe
 *
 * Disabled if SW or Push API unavailable.
 */
export function PushSubscribe() {
  const [status, setStatus] = useState<Status>("idle");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    void refreshState();
  }, []);

  async function refreshState() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setEndpoint(sub.endpoint);
        setStatus("subscribed");
        return;
      }
      const perm =
        Notification.permission === "granted"
          ? "permission-default"
          : Notification.permission === "denied"
            ? "permission-denied"
            : "permission-default";
      setStatus(perm);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  async function subscribe() {
    setError(null);
    if (!VAPID_PUBLIC_KEY) {
      setError("NEXT_PUBLIC_VAPID_PUBLIC_KEY missing in .env.local");
      setStatus("error");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("permission-denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setEndpoint(sub.endpoint);
      setStatus("subscribed");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  async function unsubscribe() {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
      setEndpoint(null);
      setStatus("permission-default");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  async function sendTest() {
    setError(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json()) as { sent?: number; failed?: number; pruned?: number };
      console.info("[push] test result", data);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-3 p-5 rounded-xl border border-border/60 bg-background/40">
      <h3 className="text-h4 font-medium">Push-Benachrichtigungen</h3>
      <p className="text-body-sm text-muted">
        Morgendlicher Recap, Post-Workout-Karte, Abend-Briefing direkt aufs Gerät.
      </p>

      {status === "unsupported" && (
        <p className="text-body-sm text-muted">Browser unterstützt keine Push-Notifications.</p>
      )}
      {status === "permission-denied" && (
        <p className="text-body-sm text-muted">
          Notifications wurden abgelehnt. Aktiviere sie in den Browser-Einstellungen.
        </p>
      )}
      {status === "subscribed" && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-body-sm">✓ aktiv</span>
          <button
            onClick={() => void unsubscribe()}
            className="text-body-sm underline hover:no-underline"
          >
            abmelden
          </button>
          <button
            onClick={() => void sendTest()}
            className="text-body-sm underline hover:no-underline"
          >
            test push
          </button>
        </div>
      )}
      {(status === "idle" || status === "permission-default") && (
        <button
          onClick={() => void subscribe()}
          className="self-start px-3 py-2 rounded-md bg-foreground text-background text-body-sm font-medium"
        >
          Aktivieren
        </button>
      )}
      {error && (
        <p className="text-body-sm text-destructive">⚠ {error}</p>
      )}
      {endpoint && (
        <details className="text-caption text-muted cursor-pointer">
          <summary>Endpoint</summary>
          <code className="block mt-1 break-all">{endpoint}</code>
        </details>
      )}
    </div>
  );
}

/** Convert VAPID base64url string to Uint8Array for PushManager.subscribe. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}
