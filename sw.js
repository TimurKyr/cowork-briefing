/* Service worker: мгновенная загрузка оболочки (cache-first) и офлайн.
   Данные Supabase НЕ кэшируем здесь — свежесть данных обеспечивает
   app.js через localStorage (stale-while-revalidate). День теперь
   читается из Google Drive (googleapis.com/drive/v3/...) — сеть-
   первым (network-first) с откатом на последний закэшированный
   ответ, чтобы офлайн показывал последний известный день.

   ВАЖНО: при изменении файлов оболочки поднимай версию кеша (v9 → v10),
   иначе пользователи залипнут на старой версии. */

const CACHE = "myday-shell-v10";
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

  // Данные Supabase — всегда сеть, не трогаем (кэшем данных заведует app.js).
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;

  // Google Drive API (день: files.list + files.get?alt=media) — сетевой-первый.
  // Кэшируем по полному URL (включает имя файла на сегодня и fileId), чтобы
  // офлайн отдал последний известный ответ. Если сети и кэша нет — запрос
  // падает, и app.js оставляет день из localStorage.
  if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/drive/")) {
    const key = req.url;
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
