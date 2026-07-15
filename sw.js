/* Минимальный service worker: нужен, чтобы PWA ставилась на домашний
   экран и открывалась быстро/офлайн. Кэшируем оболочку (index, app.js,
   иконки), но НЕ кэшируем ответы Supabase — данные всегда свежие из сети. */

const CACHE = "myday-shell-v1";
const SHELL = [
  ".",
  "index.html",
  "app.js",
  "config.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Данные Supabase и шрифты — всегда из сети (не кэшируем данные дня).
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) {
    return; // пусть браузер сходит в сеть как обычно
  }

  // Оболочка: сеть с откатом в кэш (stale-while-revalidate по-простому).
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
