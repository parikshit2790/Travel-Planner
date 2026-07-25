const CACHE = "routemosaic-public-v44";
const ASSETS = ["/", "/index.html", "/src/app.js", "/src/domain.js", "/src/seed.js", "/src/location-provider.js", "/src/destination-data.js", "/src/planner.js", "/src/styles.css", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/public/favicon.svg"];

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
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
