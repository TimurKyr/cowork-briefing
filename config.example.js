/* ─────────────────────────────────────────────────────────────
   ШАБЛОН КОНФИГА. Скопируй этот файл в config.js и впиши свои
   значения из Supabase (Project Settings → API).

     cp config.example.js config.js

   ВАЖНО: сюда идёт ТОЛЬКО anon (public) ключ — он публичен по
   назначению, его безопасно коммитить. НИКОГДА не вставляй сюда
   service_role ключ.
   ───────────────────────────────────────────────────────────── */

// URL проекта, вида https://xxxxxxxxxxxx.supabase.co
window.SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";

// anon / public ключ (Project Settings → API → Project API keys → anon public)
window.SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

// Необязательно: имя для приветствия «Доброе утро, …». Пусто — без имени.
window.APP_NAME = "";
