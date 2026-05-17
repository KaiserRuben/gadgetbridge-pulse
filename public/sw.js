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
  let data = { title: "Pulse", body: "Update verfügbar", url: "/" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_) {
    // ignore malformed payloads
  }
  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url ?? "/", topic: data.topic ?? null },
    tag: data.topic ?? "pulse",
    renotify: true,
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
