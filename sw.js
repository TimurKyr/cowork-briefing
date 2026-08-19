/* Service worker: мгновенная загрузка оболочки (cache-first) и офлайн.
   Данные (Supabase, Google Calendar API, Open-Meteo) кэшем оболочки НЕ
   трогаем — их свежесть обеспечивает app.js (localStorage + перезапрос).

   ВАЖНО: при изменении файлов оболочки поднимай версию кеша (v15 → v16),
   иначе пользователи залипнут на старой версии. */

const CACHE = "myday-shell-v16";
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
  // ВАЖНО: cache:"reload" — иначе addAll возьмёт файлы из HTTP-кеша браузера
  // (GitHub Pages отдаёт HTML с max-age) и новый SW закэширует СТАРУЮ оболочку.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
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

  // Данные — всегда сеть, оболочка их не кэширует (свежесть ведёт app.js):
  // Supabase, Google Calendar API, Open-Meteo.
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;
  if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/calendar/")) return;
  if (url.hostname === "api.open-meteo.com") return;

  // Другой origin (например, шрифты Google) — сеть с мягким откатом в кэш.
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Своя оболочка: cache-first + фоновое обновление кеша (stale-while-revalidate).
  // Ревалидация идёт с cache:"no-cache", иначе HTTP-кеш вернёт ту же старую
  // копию и обновление никогда не доедет до пользователя.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(cached ? new Request(req.url, { cache: "no-cache" }) : req)
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
