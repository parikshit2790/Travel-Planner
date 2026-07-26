const CACHE = "routemosaic-public-v53";
const ASSETS = ["/", "/index.html", "/src/app.js", "/src/domain.js", "/src/seed.js", "/src/location-provider.js", "/src/destination-data.js", "/src/planner.js", "/src/styles.css", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/public/favicon.svg", "/public/favicon.ico", "/public/favicon-16x16.png", "/public/favicon-32x32.png", "/public/apple-touch-icon.png", "/public/icon-192.png", "/public/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/src/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/sw.js") {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
