/* eslint-disable no-restricted-globals, no-undef */
/**
 * Pulse v3 service worker.
 *
 * Responsibilities:
 *   1. Handle web push events (Notification API)
 *   2. Click-through deep-links for notifications
 *   3. Minimal offline cache for the HTML shell + last daily_v3.json
 *
 * No build step — plain JS served from /sw.js.
 */

const CACHE_NAME = "pulse-v3-shell-v1";
const SHELL_URLS = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Only handle navigation requests + insight reads from the cache fallback.
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/insights/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Stash latest insight in cache for offline fallback.
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/")),
    );
  }
});

// ── Web Push handlers ────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  // Silent drop on malformed payloads — design rule. The old behaviour
  // surfaced a generic "Update verfügbar" toast which burns trust faster
  // than not notifying at all.
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch (_) {
    return;
  }
  if (!data || typeof data.title !== "string" || typeof data.body !== "string") {
    return;
  }

  // Low-priority topics do NOT renotify on tag collision (silent replace).
  // High/safety stays loud. Topic→priority bucket is fixed here so the SW
  // doesn't need to know about the prefs table.
  const LOUD_TOPICS = new Set(["safety_anomaly"]);
  const topic = typeof data.topic === "string" ? data.topic : "pulse";
  const renotify = LOUD_TOPICS.has(topic);

  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: typeof data.url === "string" ? data.url : "/", topic },
    // Prefer dedupe-keyed tag from notifier when present; falls back to
    // topic so legacy callers without `tag` still collapse per-topic.
    tag: typeof data.tag === "string" ? data.tag : topic,
    renotify,
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        for (const c of clientsArr) {
          if ("focus" in c) {
            c.navigate(url);
            return c.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
