/* ─────────────────────────────────────────────────────────────
   ШАБЛОН КОНФИГА. Скопируй в config.js и впиши свои значения.

     cp config.example.js config.js

   Сайт читает всё сам из браузера, без агента:
   • события — Google Calendar API (публичные календари + API-ключ);
   • погода — Open-Meteo (без ключа);
   • дела и дедлайны — Supabase (anon-ключ).

   Все ключи здесь ПУБЛИЧНЫЕ по назначению — их безопасно коммитить.
   НИКОГДА не вставляй сюда service_role Supabase или Google-ключ без
   ограничений по HTTP-referrer.
   ───────────────────────────────────────────────────────────── */

/* ── Supabase (дела и дедлайны) ─────────────────────────────── */
window.SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

/* ── Google Calendar API (события дня) ───────────────────────
   Тот же Google API-ключ, что и раньше, но с ВКЛЮЧЁННЫМ «Google
   Calendar API» (Cloud Console → APIs & Services → Library). Ключ
   ограничь по HTTP-referrer на домен сайта и по API — только
   Calendar API (можно оставить и Drive, если он ещё где-то нужен).

   Каждый календарь нужно сделать ПУБЛИЧНЫМ: настройки календаря →
   «Доступ для всех» → «Просматривать все данные о событиях». ID
   календаря — там же, в «Интеграция календаря».

   kind    — тип для цвета по умолчанию (work/study/sport/break/hobby/other);
   colorId — число 1–11 из палитры Google (перебивает цвет по kind).
   Значения colorId ниже — предположительные, сверь с реальными
   цветами своих календарей и поправь. */
window.CALENDAR_API_KEY = "YOUR-RESTRICTED-GOOGLE-API-KEY";
window.CALENDARS = [
  { id: "c_96e4afed3ecc27d931b77eeea843246f06757ee0d943de711220cff90bcad82b@group.calendar.google.com", kind: "other", colorId: 6 },  // Daily   — оранжевый (Tangerine)
  { id: "c_ee9dc60ab32d1c6e5ba976f581144874e57e03d2597d2141559c8b44fae1e590@group.calendar.google.com", kind: "study", colorId: 3 },  // Study   — фиолетовый (Grape)
  { id: "c_823a53d82cb5139cb97eea6592ec765aa5ceb6f9b2ff592d1fbac434108415ba@group.calendar.google.com", kind: "work",  colorId: 8 },  // Work    — графит (Graphite)
  { id: "c_db1bacdbeb066159f1343428a49682b3104f12a77b647b95d5d884afbde67dc9@group.calendar.google.com", kind: "sport", colorId: 7 },  // Workout — синий (Peacock)
];

/* ── Погода (Open-Meteo, без ключа) ─────────────────────────
   Координаты города. По умолчанию — Астана. */
window.LAT = 51.16;
window.LON = 71.47;

/* Необязательно: имя для приветствия «Доброе утро, …». Пусто — без имени. */
window.APP_NAME = "";
