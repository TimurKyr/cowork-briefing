/* ─────────────────────────────────────────────────────────────
   ЛОКАЛЬНЫЙ КОНФИГ. Сайт читает всё сам из браузера:
   • события — Google Calendar API (публичные календари + ключ);
   • погода — Open-Meteo (без ключа);
   • дела и дедлайны — Supabase (anon-ключ).
   Файл КОММИТИТСЯ — все ключи публичны по назначению.
   ───────────────────────────────────────────────────────────── */

window.SUPABASE_URL = "https://nkxiobomcgdcxcotszgn.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_GcWNGR5dZh34iIm0mlilIg_gg2EFJTi";

// Тот же Google-ключ, что был у Drive. ВКЛЮЧИ на нём Google Calendar API
// (Cloud Console → APIs & Services → Library → Google Calendar API → Enable).
window.CALENDAR_API_KEY = "AIzaSyAjAS4NyVH7NpyxMjKB6Vm3WLjHhQ82jJI";

// Сделай каждый календарь публичным (настройки календаря → «Доступ для всех» →
// «Просматривать все данные о событиях»). colorId — предположительный, сверь.
window.CALENDARS = [
  { id: "c_96e4afed3ecc27d931b77eeea843246f06757ee0d943de711220cff90bcad82b@group.calendar.google.com", kind: "other", colorId: 6 },  // Daily   — оранжевый
  { id: "c_ee9dc60ab32d1c6e5ba976f581144874e57e03d2597d2141559c8b44fae1e590@group.calendar.google.com", kind: "study", colorId: 3 },  // Study   — фиолетовый
  { id: "c_823a53d82cb5139cb97eea6592ec765aa5ceb6f9b2ff592d1fbac434108415ba@group.calendar.google.com", kind: "work",  colorId: 8 },  // Work    — графит
  { id: "c_db1bacdbeb066159f1343428a49682b3104f12a77b647b95d5d884afbde67dc9@group.calendar.google.com", kind: "sport", colorId: 7 },  // Workout — синий
];

// Погода — координаты города (Астана).
window.LAT = 51.16;
window.LON = 71.47;

window.APP_NAME = "Тимур";
