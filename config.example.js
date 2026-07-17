/* ─────────────────────────────────────────────────────────────
   ШАБЛОН КОНФИГА. Скопируй этот файл в config.js и впиши свои
   значения.

     cp config.example.js config.js

   ВАЖНО: сюда идут только anon (public) ключ Supabase и
   ограниченный (restricted) API-ключ Google Drive — оба публичны
   по назначению, их безопасно коммитить. НИКОГДА не вставляй сюда
   service_role ключ Supabase или ключ Google без ограничений.
   ───────────────────────────────────────────────────────────── */

// URL проекта, вида https://xxxxxxxxxxxx.supabase.co
// Используется ТОЛЬКО для tasks/deadlines (их пишет браузер).
window.SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";

// anon / public ключ (Project Settings → API → Project API keys → anon public)
window.SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

/* ── День (фокус/погода/таймлайн) — из Google Drive ──────────
   Агент каждое утро СОЗДАЁТ новый файл day-YYYY-MM-DD.json (за
   сегодняшнюю дату) в этой папке Drive. Файл никогда не
   перезаписывается — только создаётся новый на новую дату,
   поэтому сайт каждый день ищет файл по имени заново.

   Как заполнить:
   1. Создай в Google Drive отдельную папку, например «Мой день».
   2. Расшарь её: Поделиться → «Все, у кого есть ссылка» → Читатель.
   3. ID папки — это часть ссылки после /folders/:
      https://drive.google.com/drive/folders/ВОТ_ЭТО_ID
   4. Создай в Google Cloud Console API-ключ, ограниченный:
      - API restrictions → только Google Drive API;
      - Application restrictions → HTTP referrers → домен сайта
        (например https://<логин>.github.io/*).
   5. Вставь оба значения ниже. */
window.DRIVE_FOLDER_ID = "YOUR-DRIVE-FOLDER-ID";
window.DRIVE_API_KEY = "YOUR-RESTRICTED-DRIVE-API-KEY";

// Необязательно: имя для приветствия «Доброе утро, …». Пусто — без имени.
window.APP_NAME = "";
