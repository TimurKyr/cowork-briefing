/* ─────────────────────────────────────────────────────────────
   ЛОКАЛЬНЫЙ КОНФИГ. Supabase — для tasks/deadlines (пишет браузер).
   Google Drive — для дня (фокус/погода/таймлайн), его создаёт
   агент файлом day-YYYY-MM-DD.json. Этот файл КОММИТИТСЯ — так и
   задумано: anon-ключ Supabase и restricted-ключ Drive публичны
   по назначению.
   ───────────────────────────────────────────────────────────── */

window.SUPABASE_URL = "https://nkxiobomcgdcxcotszgn.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_GcWNGR5dZh34iIm0mlilIg_gg2EFJTi";

// TODO: впиши после того, как создашь и расшаришь папку в Drive и
// сделаешь restricted API-ключ (см. config.example.js / README.md).
window.DRIVE_FOLDER_ID = "YOUR-DRIVE-FOLDER-ID";
window.DRIVE_API_KEY = "YOUR-RESTRICTED-DRIVE-API-KEY";

window.APP_NAME = "Тимур";
