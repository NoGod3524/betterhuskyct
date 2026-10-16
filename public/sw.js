// BetterHuskyCT service worker: makes the app shell work offline.
//
// Strategy: navigations go network-first (so a new deploy is picked up straight
// away, with the cached shell as the offline fallback), while hashed build
// assets are cache-first because their URLs change whenever their content does.
// Bump CACHE_VERSION when this caching behaviour changes.
// v2: pages are cached per route. Bumping clears v1, whose "/" entry may hold
// another route's page or an error page.
// v3: Link navigations fetch RSC, so also save a separate HTML copy for cold offline openings.
const CACHE_VERSION = "huskypilot-v3";
const APP_SHELL = "/";
// A static page with no scripts, for a route that was never opened online. The home page's HTML
// cannot stand in for another route: the app hydrates it for the route in the address bar, and
// the two do not match.
const OFFLINE_PAGE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([APP_SHELL, OFFLINE_PAGE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Calendar imports must always hit the network, never the cache.
  if (url.pathname.startsWith("/api/")) return;

  // Next Link visits do not request a document. Fetch HTML without the RSC query or headers;
  // replaying an RSC response as a document would not hydrate. The original RSC request is untouched.
  if (request.headers.get("RSC") === "1") {
    event.waitUntil(
      fetch(url.origin + url.pathname, { headers: { Accept: "text/html" } })
        .then((response) => {
          if (response.ok && !response.redirected && response.headers.get("content-type")?.includes("text/html")) {
            return caches.open(CACHE_VERSION).then((cache) => cache.put(url.pathname, response));
          }
        })
        .catch(() => undefined),
    );
    return;
  }

  // Each route is cached under its own path. They all used to be written to "/",
  // so offline, every route served whichever page was visited last — /plan's
  // HTML at /tasks — and a 500 page could become the shell. Only a real page is
  // kept; offline falls back to the route's own copy, then to the offline page.
  if (request.mode === "navigate") {
    const key = url.pathname;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_VERSION).then((cache) => cache.put(key, copy)).catch(() => undefined),
            );
          }
          return response;
        })
        .catch(() =>
          caches
            .match(key)
            .then((cached) => cached || caches.match(OFFLINE_PAGE)),
        ),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            // Cache-first means a stored error would be served for good.
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(
                caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined),
              );
            }
            return response;
          }),
      ),
    );
  }
});

// Tapping a reminder should bring the app forward instead of opening a copy.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) =>
          client.url.startsWith(self.registration.scope),
        );
        return existing ? existing.focus() : self.clients.openWindow("/");
      }),
  );
});
