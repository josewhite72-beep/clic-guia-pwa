const CACHE_NAME = "guia-paso-a-paso-proceso-panamacompra-v1";
const ASSETS = ["./","./index.html","./manifest.webmanifest","./sw.js","./icon-512.png","./assets/page-001.webp","./assets/page-002.webp","./assets/page-003.webp","./assets/page-004.webp","./assets/page-005.webp","./assets/page-006.webp","./assets/page-007.webp"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u)))));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("guia-") && k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((c) => c || fetch(req).then((r) => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE_NAME).then((cc) => cc.put(req, cp)); }
      return r;
    }).catch(async () => {
      if (req.mode === "navigate") { const f = await caches.match("./index.html"); if (f) return f; }
      return new Response("Offline", { status: 503 });
    }))
  );
});
