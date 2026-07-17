/* Service worker: мгновенная загрузка оболочки (cache-first) и офлайн.
   Данные Supabase НЕ кэшируем здесь — свежесть данных обеспечивает
   app.js через localStorage (stale-while-revalidate).

   ВАЖНО: при изменении файлов оболочки поднимай версию кеша (v2 → v3),
   иначе пользователи залипнут на старой версии. */

const CACHE = "myday-shell-v3";
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
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Данные Supabase — всегда сеть, не трогаем (кэшем данных заведует app.js).
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;

  // data/today.json — сетевой-первый (в обход кэша Pages идёт с ?v=timestamp).
  // Кэшируем без query-строки, чтобы офлайн отдать последний известный день,
  // а НЕ index.html (иначе JSON-парсинг сломался бы). Если сети и кэша нет —
  // запрос падает, и app.js оставляет день из localStorage.
  if (url.pathname.endsWith("/data/today.json")) {
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(key))
    );
    return;
  }

  // Другой origin (например, шрифты Google) — сеть с мягким откатом в кэш.
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Своя оболочка: cache-first + фоновое обновление кеша (stale-while-revalidate).
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || caches.match("index.html"));
      return cached || network;
    })
  );
});
