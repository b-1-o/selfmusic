const CACHE_NAME = "selfmusic-shell-v2";
const OFFLINE_AUDIO_CACHE = "selfmusic-offline-audio-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", "/icon.svg", "/manifest.webmanifest"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![CACHE_NAME, OFFLINE_AUDIO_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Deliberately separate offline playback URLs from authenticated API URLs.
  // The page only creates these cache entries after the signed-in user taps
  // "Save offline". They can then be played while the home server is unreachable.
  if (url.pathname.startsWith("/__selfmusic_offline/")) {
    event.respondWith((async () => {
      const cache = await caches.open(OFFLINE_AUDIO_CACHE);
      const cached = await cache.match(request, { ignoreSearch: false });
      if (cached) return cached;

      const encodedId = url.pathname.slice("/__selfmusic_offline/".length);
      let trackId = "";
      try { trackId = decodeURIComponent(encodedId); } catch {}
      if (!trackId || trackId.includes("/") || trackId.includes("\\") || trackId === "." || trackId === "..") {
        return new Response("Invalid offline track ID.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      try {
        return await fetch(new Request("/api/stream/" + encodeURIComponent(trackId), {
          method: "GET",
          credentials: "same-origin",
          headers: request.headers,
        }));
      } catch {
        return new Response("This track is not saved on this device. Connect to the server and save it for offline playback.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
