"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once on app load. Place in the root layout.
 * No-op outside the browser. Logs warnings to console on failure.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NEXT_PUBLIC_DISABLE_SW === "1") return;

    let cancelled = false;
    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;
        console.info("[pwa] sw registered", reg.scope);
      } catch (err) {
        console.warn("[pwa] sw register failed", err);
      }
    };
    void register();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
