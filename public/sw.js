// オフラインでも起動できるようにアプリ本体をキャッシュする
const CACHE = "fieldlog-v9";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;   // データは毎回サーバーから
  // 自分のファイル：ネット優先（更新をすぐ反映）、つながらなければキャッシュ
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
    return;
  }
  // 地図ライブラリ（Leaflet）：キャッシュ優先
  if (url.host === "unpkg.com") {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
  }
});
