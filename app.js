/* ─────────────────────────────────────────────────────────────
   «Мой день» — сайт читает всё сам из браузера, без агента.

   • События дня — напрямую из Google Calendar API (несколько
     календарей из config, склеиваются и сортируются). Промежутки
     свободного времени (>120 мин) считает сам сайт.
   • Погода (только для сегодня) — Open-Meteo, без ключа.
   • Задачи `tasks` и дедлайны `deadlines` — Supabase (чтение/запись).

   Навигация: можно листать дни вперёд/назад (свайп / стрелки / кнопки).
   «Сейчас», строка «сейчас/дальше» и погода — только когда открыт сегодня.

   ВРЕМЯ: всё «сегодня»/«сейчас» считается по Asia/Almaty (UTC+5),
   независимо от часового пояса устройства.
   ───────────────────────────────────────────────────────────── */

/* ── Supabase REST helpers ─────────────────────────────────── */
const SB = (typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) ? SUPABASE_URL.replace(/\/+$/, "") : "";
const KEY = (typeof SUPABASE_ANON_KEY !== "undefined" && SUPABASE_ANON_KEY) ? SUPABASE_ANON_KEY : "";

const restHeaders = (extra = {}) => ({
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

async function sbGet(path) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: restHeaders() });
  if (!res.ok) { const t = await res.text(); throw new HttpError(`GET ${path} → ${res.status} ${t}`, res.status); }
  return res.json();
}
async function sbPatch(path, body) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method: "PATCH", headers: restHeaders({ Prefer: "return=representation" }), body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new HttpError(`PATCH ${path} → ${res.status} ${t}`, res.status); }
  return res.json();
}
async function sbInsert(path, body) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method: "POST", headers: restHeaders({ Prefer: "return=representation" }), body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new HttpError(`POST ${path} → ${res.status} ${t}`, res.status); }
  return res.json();
}
class HttpError extends Error { constructor(m, status) { super(m); this.status = status; } }

/* ── время (Asia/Almaty) ───────────────────────────────────── */
const TZ = "Asia/Almaty";
function pad(n) { return String(n).padStart(2, "0"); }

// Сегодняшняя дата в Алматы, YYYY-MM-DD. en-CA форматирует именно так.
function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
// Текущее время в Алматы как {h, m}.
function almatyHM() {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  let [h, m] = s.split(":").map(Number);
  if (h === 24) h = 0; // на случай, если движок вернёт 24:00 в полночь
  return { h, m };
}
const nowMin = () => { const { h, m } = almatyHM(); return h * 60 + m; };
// HH:MM в Алматы из ISO-таймстампа (для updated_at).
function fmtAlmatyTime(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch { return null; }
}

const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };

const KNOWN_KINDS = ["work", "study", "sport", "break", "hobby", "other"];
const kindVar = (k) => (KNOWN_KINDS.includes(k) ? k : "other");

// Официальная палитра цветов событий Google Calendar (colorId 1–11 → hex).
const GCAL_EVENT_COLORS = {
  1: "#7986cb",   // Lavender
  2: "#33b679",   // Sage
  3: "#8e24aa",   // Grape
  4: "#e67c73",   // Flamingo
  5: "#f6c026",   // Banana
  6: "#f5511d",   // Tangerine
  7: "#039be5",   // Peacock
  8: "#616161",   // Graphite
  9: "#3f51b5",   // Blueberry
  10: "#0b8043",  // Basil
  11: "#d60000",  // Tomato
};

const isFreeBlock = (block) => block && block.kind === "free";

// Цвет блока таймлайна: свободное время — приглушённый muted; иначе валидный
// colorId из палитры Google → hex; иначе — текущий цвет по kind (CSS-переменная).
function resolveBlockColor(block) {
  if (isFreeBlock(block)) return "var(--muted)";
  const id = block && block.colorId != null ? Number(block.colorId) : NaN;
  if (Number.isInteger(id) && GCAL_EVENT_COLORS[id]) return GCAL_EVENT_COLORS[id];
  return `var(--${kindVar(block && block.kind)})`;
}

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];
// dateLabel принимает строку "YYYY-MM-DD"; полдень, чтобы не задеть границы суток.
function dateLabel(iso) {
  const d = new Date(iso + "T12:00:00");
  const wd = WEEKDAYS[d.getDay()];
  return `${wd.charAt(0).toUpperCase() + wd.slice(1)}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function greetingWord() {
  const { h } = almatyHM();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}
// Разница в целых днях между iso-датой и сегодня (Алматы), положительная — в будущем.
function dayDiff(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = state.date.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}
// Русское склонение «день/дня/дней».
function plDays(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return "дней";
  if (b > 1 && b < 5) return "дня";
  if (b === 1) return "день";
  return "дней";
}
// Календарная дата (Алматы) из ISO-таймстампа → "YYYY-MM-DD".
function almatyDateOf(iso) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso)); }
  catch { return null; }
}
// Возраст задачи в днях по created_at (Алматы). Нет created_at — считаем по date.
function taskAgeDays(task) {
  const src = task.created_at ? almatyDateOf(task.created_at) : (task.date || null);
  if (!src) return 0;
  return -dayDiff(src);   // dayDiff(прошлое) отрицателен → возраст положителен
}
// Подпись возраста под задачей: {text, accent} или null (создана сегодня).
function taskAgeLabel(task) {
  const age = taskAgeDays(task);
  if (age <= 0) return null;
  const text = age === 1 ? "⤷ со вчера" : `⤷ ${age} ${plDays(age)} назад`;
  return { text, accent: age >= 7 };   // от недели — акцентный цвет
}

// Прибавить дни к дате "YYYY-MM-DD" (через UTC, чтобы не задеть часовой пояс).
function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * 86400000).toISOString().slice(0, 10);
}
/* ── состояние + локальный кэш ─────────────────────────────── */
const CACHE_KEY = "myday-cache-v2";
const state = {
  date: todayISO(),   // сегодня (Алматы) — точка отсчёта для возраста/дедлайнов/задач
  view: todayISO(),   // просматриваемая дата (влияет ТОЛЬКО на раздел «План»)
  day: null,          // { date, timeline: [...] } за просматриваемый день
  today: null,        // расписание СЕГОДНЯ (для строки «сейчас/дальше», не зависит от view)
  weather: null,      // строка погоды (сегодня)
  tasks: [],
  deadlines: [],
  offline: false,     // последняя загрузка не удалась из-за сети → показываем кэш
  loading: false,     // идёт запрос календаря
  hydrated: false,    // отрисовали хоть раз из кэша/сети
  lastRefresh: null,  // время последнего успешного обновления (мс)
  errConfig: null, errPlan: null, errTasks: null,  // тексты баннера по источникам
};
let loadToken = 0;    // защита от гонок при быстрой навигации

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      view: state.view, day: state.day, weather: state.weather,
      tasks: state.tasks, deadlines: state.deadlines,
      lastRefresh: state.lastRefresh, savedAt: Date.now(),
    }));
  } catch { /* приватный режим / нет места — не критично */ }
}
function loadCache() {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

/* ── события из Google Calendar API ───────────────────────────
   Для каждого календаря из config запрашиваем события выбранного дня
   (по Asia/Almaty). kind и colorId берём от календаря-источника, не от
   события. События на весь день (без времени) пропускаем. */
const CAL_KEY = (typeof CALENDAR_API_KEY !== "undefined" && CALENDAR_API_KEY) ? CALENDAR_API_KEY : "";
const CALS = (typeof CALENDARS !== "undefined" && Array.isArray(CALENDARS)) ? CALENDARS : [];
const W_LAT = (typeof window !== "undefined" && window.LAT != null) ? window.LAT : null;
const W_LON = (typeof window !== "undefined" && window.LON != null) ? window.LON : null;

function eventToBlock(ev, cal, date) {
  if (!ev.start || !ev.start.dateTime) return null;   // событие на весь день — пропускаем
  let start = fmtAlmatyTime(ev.start.dateTime);
  let end = ev.end && ev.end.dateTime ? fmtAlmatyTime(ev.end.dateTime) : start;
  // событие могло начаться вчера / кончиться завтра — обрезаем к выбранному дню
  if (almatyDateOf(ev.start.dateTime) < date) start = "00:00";
  if (ev.end && ev.end.dateTime && almatyDateOf(ev.end.dateTime) > date) end = "23:59";
  const descr = (typeof ev.description === "string" && ev.description.trim() !== "") ? ev.description : undefined;
  return {
    start, end,
    title: ev.summary || "(без названия)",
    location: ev.location || undefined,
    description: descr,
    kind: cal.kind || "other",
    colorId: cal.colorId,
  };
}

async function fetchCalendarEvents(date) {
  const timeMin = `${date}T00:00:00+05:00`;
  const timeMax = `${date}T23:59:59+05:00`;
  const settled = await Promise.allSettled(CALS.map(async (cal) => {
    const params = new URLSearchParams({
      key: CAL_KEY, singleEvents: "true", orderBy: "startTime",
      timeMin, timeMax, timeZone: TZ,
    });
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params.toString()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new HttpError(`Calendar ${cal.kind || cal.id} → ${res.status}`, res.status);
    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];
    return items.map((ev) => eventToBlock(ev, cal, date)).filter(Boolean);
  }));

  const blocks = [];
  let anyOk = false, firstErr = null;
  settled.forEach((s) => {
    if (s.status === "fulfilled") { anyOk = true; blocks.push(...s.value); }
    else if (!firstErr) firstErr = s.reason;
  });
  if (!anyOk && firstErr) throw firstErr;   // все календари отвалились
  blocks.sort((a, b) => toMin(a.start) - toMin(b.start));
  return blocks;
}

// Вставляем псевдо-блоки свободного времени (>120 мин) МЕЖДУ событиями.
function withFreeBlocks(events) {
  const evs = events.slice().sort((a, b) => toMin(a.start) - toMin(b.start));
  const out = [];
  for (let i = 0; i < evs.length; i++) {
    out.push(evs[i]);
    const next = evs[i + 1];
    if (next) {
      const prevEnd = toMin(evs[i].end || evs[i].start);
      const gap = toMin(next.start) - prevEnd;
      if (gap > 120) out.push({ start: evs[i].end, end: next.start, title: "Свободно", kind: "free" });
    }
  }
  return out;
}

/* ── погода из Open-Meteo (без ключа, только сегодня) ─────────── */
const WMO = {
  0: "ясно", 1: "малооблачно", 2: "переменная облачность", 3: "пасмурно",
  45: "туман", 48: "туман",
  51: "морось", 53: "морось", 55: "морось", 56: "морось", 57: "морось",
  61: "дождь", 63: "дождь", 65: "сильный дождь", 66: "ледяной дождь", 67: "ледяной дождь",
  71: "снег", 73: "снег", 75: "сильный снег", 77: "снежная крупа",
  80: "ливень", 81: "ливень", 82: "сильный ливень",
  85: "снегопад", 86: "снегопад",
  95: "гроза", 96: "гроза с градом", 99: "гроза с градом",
};
async function fetchWeather() {
  if (W_LAT == null || W_LON == null) return null;
  const params = new URLSearchParams({
    latitude: String(W_LAT), longitude: String(W_LON),
    current: "temperature_2m,weather_code", timezone: TZ,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new HttpError(`Weather → ${res.status}`, res.status);
  const j = await res.json();
  if (!j.current) return null;
  const t = Math.round(j.current.temperature_2m);
  const desc = WMO[j.current.weather_code] || "погода";
  return `${desc}, ${t > 0 ? "+" : ""}${t}°`;
}

/* ── загрузка «плана» (события выбранного дня) ────────────────
   Смена дня трогает ТОЛЬКО раздел «План»: перезапрашиваем календарь
   на state.view. Погода, чеклист, дедлайны, приветствие — всегда сегодня,
   их этот вызов не трогает. */
async function loadPlan() {
  const token = ++loadToken;
  const view = state.view;
  updateConfigErr();
  if (!(CAL_KEY && CALS.length)) { render(); return; }

  state.loading = true;
  setRefreshing(true);
  render();

  try {
    const events = await fetchCalendarEvents(view);
    if (token !== loadToken) return;
    const blocks = withFreeBlocks(events);
    state.day = { date: view, timeline: blocks };
    if (view === state.date) state.today = blocks;   // сохраняем сегодняшний план для строки «сейчас/дальше»
    state.errPlan = null;
    state.offline = false;
  } catch (err) {
    if (token !== loadToken) return;
    console.error(err);
    if (err instanceof TypeError) { state.offline = true; }          // нет сети — оставляем прежнее
    else {
      state.day = { date: view, timeline: [] };
      if (view === state.date) state.today = [];
      state.errPlan = "Не удалось получить события календаря. Проверь ключ, включённый Calendar API и что календари публичные.";
    }
  }
  if (token !== loadToken) return;
  state.loading = false;
  setRefreshing(false);
  if (!state.offline) state.lastRefresh = Date.now();
  saveCache();
  render();
}

/* ── загрузка «сегодняшнего контекста»: погода + задачи + дедлайны ──
   Не зависит от выбранного дня — всегда за сегодня. */
async function loadContext() {
  const haveSB = Boolean(SB && KEY);

  // погода (сегодня)
  try { state.weather = await fetchWeather(); state.errWeather = null; }
  catch (err) { console.error(err); if (err instanceof TypeError) state.offline = true; }

  // задачи (сегодня + перенос) и дедлайны
  if (haveSB) {
    try {
      const tq = `tasks?or=(date.eq.${state.date},and(date.lt.${state.date},done.eq.false))&order=position.asc,created_at.asc`;
      const [tasks, deadlines] = await Promise.all([
        sbGet(tq),
        sbGet(`deadlines?done=eq.false&order=due_date.asc,created_at.asc`),
      ]);
      state.tasks = Array.isArray(tasks) ? tasks : [];
      state.deadlines = Array.isArray(deadlines) ? deadlines : [];
      state.errTasks = null;
    } catch (err) {
      console.error(err);
      if (err instanceof TypeError) state.offline = true;
      else state.errTasks = "Не удалось получить дела/дедлайны из Supabase. Проверь URL/ключ, миграцию и политики RLS.";
    }
  }
  state.hydrated = true;
  saveCache();
  render();
}

// Полное обновление (кнопка ⟳): и план выбранного дня, и сегодняшний контекст.
function load() { updateConfigErr(); loadContext(); loadPlan(); }

function updateConfigErr() {
  const cfg = [];
  if (!(CAL_KEY && CALS.length)) cfg.push("CALENDAR_API_KEY / CALENDARS — события недоступны.");
  if (!(SB && KEY)) cfg.push("SUPABASE_URL / SUPABASE_ANON_KEY — дела и дедлайны недоступны.");
  state.errConfig = cfg.length ? "Не заполнен config.js: " + cfg.join(" ") + " Открой config.js и вставь значения." : null;
}

function setRefreshing(on) {
  const b = document.getElementById("refreshBtn");
  if (b) b.classList.toggle("loading", on);
}

// Общий баннер: конфиг / календарь / supabase.
function renderBanner() {
  const msgs = [];
  if (state.errConfig) msgs.push(state.errConfig);
  if (state.errPlan) msgs.push(state.errPlan);
  if (state.errTasks) msgs.push(state.errTasks);
  const b = document.getElementById("banner");
  if (msgs.length) { b.textContent = msgs.join(" "); b.classList.remove("hidden"); }
  else b.classList.add("hidden");
}

/* ── навигация по дням (только «План») ───────────────────────── */
function setView(dateISO) {
  state.view = dateISO;
  render();      // мгновенно перерисовываем шапку/дату
  loadPlan();    // и подгружаем расписание нового дня — остальное не трогаем
}
function shiftDay(delta) { setView(addDaysISO(state.view, delta)); }
function goToday() { if (state.view !== state.date) setView(state.date); }

/* ── рендер ────────────────────────────────────────────────── */
function render() {
  renderHeader();
  renderNowNext();
  renderDeadlines();
  renderPlan();
  renderList();
  renderBanner();
}

function renderHeader() {
  const isToday = state.view === state.date;
  // дата в шапке = выбранный день плана; кнопка «Сегодня» — когда день не сегодняшний
  document.getElementById("dateline").textContent = dateLabel(state.view);
  document.getElementById("todayBtn").classList.toggle("hidden", isToday);

  // приветствие — всегда по текущему времени (сегодня)
  const nameEl = document.getElementById("name");
  const greetingEl = document.getElementById("greeting");
  const g = greetingWord();
  greetingEl.firstChild.textContent = APP_NAME ? g + "," : g;
  nameEl.textContent = APP_NAME || "";

  // subline: погода — всегда сегодняшняя (не зависит от выбранного дня)
  const sub = document.getElementById("subline");
  const parts = [];
  if (state.weather) parts.push(state.weather);
  sub.innerHTML = parts.map((s, i) => (i ? '<span class="dot"></span>' : "") + `<span>${escapeHtml(s)}</span>`).join("");

  // футер: состояние загрузки / время обновления / офлайн
  const footer = document.getElementById("footer");
  let base;
  if (state.loading) base = "обновление…";
  else if (state.lastRefresh) base = "обновлено в " + fmtAlmatyTime(new Date(state.lastRefresh).toISOString());
  else base = "—";
  if (state.offline) base += " · офлайн";
  footer.textContent = base;
}

// Строка «сейчас / дальше» — всегда по СЕГОДНЯШНЕМУ расписанию (state.today),
// не зависит от выбранного в «Плане» дня.
function renderNowNext() {
  const el = document.getElementById("nownext");
  const blocks = Array.isArray(state.today) ? state.today : [];
  if (!blocks.length) { el.classList.add("hidden"); return; }

  const now = nowMin();
  // free-блоки — не занятия: в расчёте «сейчас/дальше» учитываем только реальные события.
  const sorted = blocks.slice()
    .filter((b) => !isFreeBlock(b))
    .sort((a, b) => toMin(a.start || "00:00") - toMin(b.start || "00:00"));
  if (!sorted.length) { el.classList.add("hidden"); return; }
  const current = sorted.find((b) => {
    const s = toMin(b.start || "00:00"), e = toMin(b.end || b.start || "00:00");
    return now >= s && now < e;
  });
  const next = sorted.find((b) => toMin(b.start || "00:00") > now);

  let html;
  const nx = (b) => `дальше в <span class="at">${escapeHtml(b.start)}</span> — <span class="nx">${escapeHtml(b.title || "")}</span>`;
  if (current && next) {
    html = `Сейчас: <span class="cur">${escapeHtml(current.title || "")}</span> · ${nx(next)}`;
  } else if (current && !next) {
    html = `Сейчас: <span class="cur">${escapeHtml(current.title || "")}</span> · дальше — всё`;
  } else if (!current && next) {
    html = `<span class="free">Сейчас свободно</span> · ${nx(next)}`;
  } else {
    html = `<span class="free">На сегодня всё</span>`;
  }
  el.innerHTML = html;
  // Акцент строки красим цветом текущего блока (если он есть), иначе — dawn.
  if (current) el.style.setProperty("--tag", resolveBlockColor(current));
  else el.style.removeProperty("--tag");
  el.classList.remove("hidden");
}

// Дедлайны
function renderDeadlines() {
  const head = document.getElementById("dlHead");
  const list = document.getElementById("deadlines");
  const meta = document.getElementById("dlMeta");
  const open = state.deadlines.filter((d) => !d.done);

  list.innerHTML = "";
  if (!open.length) {
    // секцию (заголовок + список) не рисуем; форма добавления остаётся видимой
    head.classList.add("hidden");
    list.classList.add("hidden");
    return;
  }
  head.classList.remove("hidden");
  list.classList.remove("hidden");
  meta.textContent = `${open.length}`;

  open.slice().sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0)).forEach((d) => {
    const diff = dayDiff(d.due_date);
    const u = dlUrgency(diff);
    const el = document.createElement("div");
    el.className = "dl" + (d._pending ? " pending" : "");
    el.style.setProperty("--tag", u.color);
    el.innerHTML = `<div class="dl-title"></div><div class="dl-count">${escapeHtml(u.text)}</div>`;
    el.querySelector(".dl-title").textContent = d.title;
    el.onclick = () => toggleDeadline(d);
    list.appendChild(el);
  });
}
function dlUrgency(diff) {
  if (diff < 0) return { color: "var(--sport)", text: `просрочено на ${Math.abs(diff)} дн.` };
  if (diff === 0) return { color: "var(--sport)", text: "сегодня" };
  if (diff === 1) return { color: "var(--sport)", text: "завтра" };
  if (diff <= 3) return { color: "var(--dawn)", text: `осталось ${diff} ${plDays(diff)}` };
  return { color: "var(--muted)", text: `осталось ${diff} ${plDays(diff)}` };
}

function renderPlan() {
  const empty = document.getElementById("emptyState");
  const planHead = document.getElementById("planHead");
  const timeline = document.getElementById("timeline");
  const isToday = state.view === state.date;

  const dayReady = state.day && state.day.date === state.view;
  const blocks = dayReady && Array.isArray(state.day.timeline) ? state.day.timeline : [];

  planHead.classList.remove("hidden");

  // загрузка нового дня без данных / пустой день
  if (!blocks.length) {
    timeline.classList.add("hidden");
    empty.classList.remove("hidden");
    if (state.loading && !dayReady) {
      empty.innerHTML = `<strong>Загрузка…</strong>Подтягиваю события выбранного дня.`;
    } else {
      empty.innerHTML = `<strong>На этот день событий нет</strong>Свободный день — ни одного события в календарях.`;
    }
    return;
  }
  empty.classList.add("hidden");
  timeline.classList.remove("hidden");

  const now = nowMin();
  timeline.innerHTML = "";
  blocks.slice().sort((a, b) => toMin(a.start || "00:00") - toMin(b.start || "00:00")).forEach((b) => {
    const s = toMin(b.start || "00:00");
    const e = toMin(b.end || b.start || "00:00");
    const free = isFreeBlock(b);
    // Маркер «сейчас»/приглушение прошедшего — только для сегодня.
    // Другие дни — просто события (нейтральный «future»). free никогда не «now».
    const stateName = !isToday
      ? "future"
      : (free
        ? (now >= e ? "past" : "future")
        : (now >= e ? "past" : (now >= s && now < e ? "now" : "future")));
    const el = document.createElement("div");
    el.className = "block" + (free ? " free" : "");
    el.dataset.state = stateName;
    el.style.setProperty("--tag", resolveBlockColor(b));
    const loc = b.location
      ? `<div class="b-loc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(b.location)}</div>`
      : "";
    const range = b.end ? `${b.start}–${b.end}` : `${b.start}`;
    const hasDesc = !free && typeof b.description === "string" && b.description.trim() !== "";
    el.innerHTML = `
      <div class="time">${escapeHtml(b.start || "")}</div>
      <div class="body">
        <div class="b-title">${escapeHtml(b.title || "")}${hasDesc ? '<span class="b-more" aria-hidden="true"></span>' : ""}</div>
        ${loc}
        <div class="b-range">${escapeHtml(range)}</div>
        ${stateName === "now" ? `<div class="now-flag"><span class="now-pulse"></span>сейчас</div>` : ""}
      </div>`;
    // Блок с непустым описанием — кликабельный и открывает модалку.
    // Без описания ведёт себя как раньше (без реакции на тап).
    if (hasDesc) {
      el.classList.add("has-desc");
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${b.title || "Событие"} — открыть описание`);
      const open = () => openBlockModal(b, range);
      el.addEventListener("click", open);
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); }
      });
    }
    timeline.appendChild(el);
  });
}

/* ── безопасный рендер HTML-описания события ─────────────────
   Разбираем строку в инертном <template> (скрипты не выполняются),
   затем заново собираем DOM только из белого списка тегов. Ссылки
   получают безопасный href (http/https/mailto/tel), target=_blank и
   rel=noopener. Так HTML из календаря отображается красиво, без риска
   инъекций. */
const ALLOWED_TAGS = new Set(["A", "B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI"]);
function safeHref(href) {
  try {
    const u = new URL(href, location.href);
    if (["http:", "https:", "mailto:", "tel:"].includes(u.protocol)) return u.href;
  } catch { /* мусорный href */ }
  return null;
}
function sanitizeInto(container, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html);
  const clean = (src, dst) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) {                    // текст
        dst.appendChild(document.createTextNode(n.nodeValue));
      } else if (n.nodeType === 1) {             // элемент
        const tag = n.tagName;
        if (ALLOWED_TAGS.has(tag)) {
          const el = document.createElement(tag.toLowerCase());
          if (tag === "A") {
            const h = safeHref(n.getAttribute("href") || "");
            if (h) { el.setAttribute("href", h); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
          }
          clean(n, el);
          dst.appendChild(el);
        } else {
          clean(n, dst);                         // тег не в списке — оставляем только содержимое
        }
      }
      // комментарии и прочее игнорируем
    });
  };
  container.innerHTML = "";
  clean(tpl.content, container);
}

/* ── модалка описания события ──────────────────────────────── */
let modalPrevFocus = null;

function openBlockModal(b, range) {
  const overlay = document.getElementById("modal");
  const titleEl = document.getElementById("modalTitle");
  const metaEl = document.getElementById("modalMeta");
  const bodyEl = document.getElementById("modalBody");

  titleEl.textContent = b.title || "Событие";

  // подзаголовок: время + место (если есть)
  metaEl.innerHTML = "";
  const timePart = document.createElement("span");
  timePart.className = "m-time";
  timePart.textContent = range;
  metaEl.appendChild(timePart);
  if (b.location) {
    const dot = document.createElement("span"); dot.className = "dot"; metaEl.appendChild(dot);
    const locPart = document.createElement("span");
    locPart.textContent = b.location;
    metaEl.appendChild(locPart);
  }

  // тело: Google Calendar кладёт в описание HTML (<br>, <a>, <b>…). Если это
  // похоже на HTML — рендерим безопасно (белый список тегов, кликабельные ссылки);
  // иначе — как обычный текст с сохранением переносов.
  if (/<[a-z][\s\S]*>/i.test(b.description)) {
    bodyEl.classList.add("rich");
    sanitizeInto(bodyEl, b.description);
  } else {
    bodyEl.classList.remove("rich");
    bodyEl.textContent = b.description;
  }

  // акцент модалки (полоска + время) — цветом того же блока
  overlay.querySelector(".modal-card").style.setProperty("--tag", resolveBlockColor(b));

  modalPrevFocus = document.activeElement;
  overlay.classList.remove("hidden");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";       // фон не скроллится под модалкой
  document.getElementById("modalClose").focus();
  document.addEventListener("keydown", onModalKey);
}

function closeModal() {
  const overlay = document.getElementById("modal");
  if (overlay.classList.contains("hidden")) return;
  overlay.classList.remove("open");
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onModalKey);
  if (modalPrevFocus && typeof modalPrevFocus.focus === "function") modalPrevFocus.focus();
  modalPrevFocus = null;
}

function onModalKey(e) {
  if (e.key === "Escape") { e.preventDefault(); closeModal(); }
}

/* ── чеклист с приоритетами ────────────────────────────────── */
const PRIORITIES = [
  { key: "high",   name: "Высокий" },
  { key: "medium", name: "Средний" },
  { key: "low",    name: "Низкий"  },
];
const PRIORITY_KEYS = PRIORITIES.map((p) => p.key);
const normPriority = (p) => (PRIORITY_KEYS.includes(p) ? p : "low");
// position может отсутствовать в старом кэше — считаем 0.
const posOf = (t) => { const n = Number(t.position); return Number.isFinite(n) ? n : 0; };
// Задачи одного приоритета в порядке position.
const tasksOf = (priority) =>
  state.tasks.filter((t) => normPriority(t.priority) === priority)
             .sort((a, b) => posOf(a) - posOf(b));

const GRIP_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;

function taskEl(task) {
  const age = taskAgeLabel(task);   // подпись реального возраста (или null, если создана сегодня)
  const el = document.createElement("div");
  el.className = "item" + (task.done ? " done" : "") + (task._pending ? " pending" : "");
  el.dataset.id = String(task.id);
  el.innerHTML =
    `<div class="box"><svg viewBox="0 0 24 24" fill="none" stroke="#14131f" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg></div>
     <div class="t-wrap"><div class="t"></div>${age ? `<div class="carried${age.accent ? " aged" : ""}"></div>` : ""}</div>
     <div class="grip" aria-label="Перетащить">${GRIP_SVG}</div>`;
  el.querySelector(".t").textContent = task.text;
  if (age) el.querySelector(".carried").textContent = age.text;
  el.addEventListener("click", (e) => {
    if (e.target.closest(".grip")) return;   // ручка не переключает отметку
    if (justDragged) return;                 // клик сразу после перетаскивания игнорируем
    toggle(task);
  });
  el.querySelector(".grip").addEventListener("pointerdown", (e) => startDrag(e, task, el));
  return el;
}

function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  PRIORITIES.forEach((p) => {
    const items = tasksOf(p.key);
    const doneN = items.filter((t) => t.done).length;
    const group = document.createElement("div");
    group.className = "pgroup";
    group.dataset.priority = p.key;
    group.innerHTML =
      `<div class="pgroup-head">
         <span class="pdot"></span><span class="pname">${p.name}</span>
         <span class="pcnt">${doneN} / ${items.length}</span>
       </div>
       <div class="pgroup-body" data-priority="${p.key}"></div>`;
    const body = group.querySelector(".pgroup-body");
    items.forEach((task) => body.appendChild(taskEl(task)));
    list.appendChild(group);
  });
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.done).length;
  document.getElementById("progress").textContent = `${done} / ${total}`;
}

/* ── перетаскивание задач (мышь + палец) ─────────────────────
   Используем Pointer Events, а не HTML5 drag-and-drop: последний
   не работает на тач-экранах. Тянуть можно только за ручку (.grip),
   у неё touch-action:none — поэтому палец тянет задачу, а страница
   при этом продолжает нормально скроллиться в остальных местах. */
let drag = null;
let justDragged = false;

function startDrag(e, task, el) {
  if (task._pending || drag) return;
  if (e.button !== undefined && e.button !== 0) return;   // только левая кнопка
  e.preventDefault();

  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = rect.width + "px";
  document.body.appendChild(ghost);

  drag = { task, el, ghost, dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
  el.classList.add("dragging");
  moveGhost(e.clientX, e.clientY);
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* не критично */ }

  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragEnd);
}

function moveGhost(x, y) {
  drag.ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px)`;
}

function onDragMove(e) {
  if (!drag) return;
  e.preventDefault();
  drag.moved = true;
  moveGhost(e.clientX, e.clientY);

  const bodies = [...document.querySelectorAll(".pgroup-body")];
  // группа под курсором, иначе ближайшая по вертикали
  let target = bodies.find((b) => {
    const r = b.getBoundingClientRect();
    return e.clientY >= r.top - 8 && e.clientY <= r.bottom + 8;
  });
  if (!target) {
    let best = null;
    bodies.forEach((b) => {
      const r = b.getBoundingClientRect();
      const d = e.clientY < r.top ? r.top - e.clientY : e.clientY - r.bottom;
      if (!best || d < best.d) best = { b, d };
    });
    target = best && best.b;
  }
  bodies.forEach((b) => b.classList.toggle("drop-active", b === target));
  if (!target) return;

  // вставляем перетаскиваемый элемент между соседями — живой предпросмотр
  const siblings = [...target.querySelectorAll(".item")].filter((x) => x !== drag.el);
  const after = siblings.find((x) => {
    const r = x.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  });
  if (after) target.insertBefore(drag.el, after);
  else target.appendChild(drag.el);
}

async function onDragEnd() {
  if (!drag) return;
  const { task, el, ghost, moved } = drag;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("pointercancel", onDragEnd);
  ghost.remove();
  el.classList.remove("dragging");
  document.querySelectorAll(".pgroup-body").forEach((b) => b.classList.remove("drop-active"));
  drag = null;

  if (!moved) return;
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 300);

  const body = el.closest(".pgroup-body");
  if (!body) { renderList(); return; }
  const newPriority = normPriority(body.dataset.priority);

  // соседи в новом порядке DOM → новая дробная позиция «между»
  const ids = [...body.querySelectorAll(".item")].map((x) => x.dataset.id);
  const byId = (id) => state.tasks.find((t) => String(t.id) === String(id));
  const idx = ids.indexOf(String(task.id));
  const prev = idx > 0 ? byId(ids[idx - 1]) : null;
  const next = idx >= 0 && idx < ids.length - 1 ? byId(ids[idx + 1]) : null;

  const prevPos = prev ? posOf(prev) : null;
  const nextPos = next ? posOf(next) : null;
  let newPos;
  if (prevPos === null && nextPos === null) newPos = 0;
  else if (prevPos === null) newPos = nextPos - 1000;
  else if (nextPos === null) newPos = prevPos + 1000;
  else newPos = (prevPos + nextPos) / 2;

  const oldPriority = normPriority(task.priority);
  const oldPos = posOf(task);
  if (oldPriority === newPriority && oldPos === newPos) { renderList(); return; }

  task.priority = newPriority;
  task.position = newPos;
  renderList();

  try {
    await sbPatch(`tasks?id=eq.${task.id}`, { priority: newPriority, position: newPos });
    saveCache();
    // точность дробей исчерпана (сосед вплотную) — разово перенумеровываем группу
    if (prev && next && (newPos === prevPos || newPos === nextPos)) await renumber(newPriority);
  } catch (err) {
    console.error(err);
    task.priority = oldPriority; task.position = oldPos;
    renderList();
    showBanner("Не удалось сохранить перемещение. Изменение отменено.");
  }
}

// Раздаём ровные позиции 1000, 2000, … — редкий случай, когда дроби «схлопнулись».
async function renumber(priority) {
  const items = tasksOf(priority);
  for (let i = 0; i < items.length; i++) {
    const p = (i + 1) * 1000;
    if (posOf(items[i]) !== p) {
      items[i].position = p;
      await sbPatch(`tasks?id=eq.${items[i].id}`, { position: p });
    }
  }
  saveCache();
  renderList();
}

/* ── действия ──────────────────────────────────────────────── */
async function toggle(task) {
  const prev = task.done;
  task.done = !prev;
  renderList();
  try {
    await sbPatch(`tasks?id=eq.${task.id}`, { done: task.done });
    saveCache();
  } catch (err) {
    console.error(err);
    task.done = prev; renderList();
    showBanner("Не удалось сохранить отметку. Изменение отменено.");
  }
}

async function addTask() {
  const inp = document.getElementById("addInput");
  const btn = document.getElementById("addBtn");
  const sel = document.getElementById("addPriority");
  const v = inp.value.trim();
  if (!v) return;
  if (!SB || !KEY) { showBanner("Нельзя добавить дело: не заполнен config.js."); return; }

  // новое дело — в начало выбранного приоритета
  const priority = normPriority(sel.value);
  const group = tasksOf(priority);
  const position = group.length ? Math.min(...group.map(posOf)) - 1000 : 0;

  const temp = { id: "temp-" + Date.now(), date: state.date, text: v, done: false,
                 carried_over: false, priority, position, _pending: true };
  state.tasks.push(temp);
  inp.value = ""; inp.disabled = true; btn.disabled = true; sel.disabled = true;
  renderList();
  try {
    const rows = await sbInsert("tasks", { date: state.date, text: v, done: false,
                                           carried_over: false, priority, position });
    const saved = rows && rows[0] ? rows[0] : null;
    const idx = state.tasks.indexOf(temp);
    if (saved && idx !== -1) state.tasks[idx] = saved;
    saveCache(); hideBanner();
  } catch (err) {
    console.error(err);
    state.tasks = state.tasks.filter((t) => t !== temp);
    showBanner("Не удалось добавить дело. Попробуй ещё раз.");
  } finally {
    inp.disabled = false; btn.disabled = false; sel.disabled = false;
    renderList(); inp.focus();
  }
}

async function toggleDeadline(d) {
  // помечаем done → уходит из списка незакрытых
  d._pending = true; renderDeadlines();
  try {
    await sbPatch(`deadlines?id=eq.${d.id}`, { done: true });
    state.deadlines = state.deadlines.filter((x) => x.id !== d.id);
    saveCache(); renderDeadlines();
  } catch (err) {
    console.error(err);
    d._pending = false; renderDeadlines();
    showBanner("Не удалось закрыть дедлайн. Попробуй ещё раз.");
  }
}

async function addDeadline() {
  const titleEl = document.getElementById("dlTitle");
  const dateEl = document.getElementById("dlDate");
  const btn = document.getElementById("dlBtn");
  const title = titleEl.value.trim();
  const due = dateEl.value; // "YYYY-MM-DD" от нативного input
  if (!title) { titleEl.focus(); return; }
  if (!due) { showBanner("У дедлайна нужна дата."); dateEl.focus(); return; }
  if (!SB || !KEY) { showBanner("Нельзя добавить дедлайн: не заполнен config.js."); return; }

  const temp = { id: "temp-" + Date.now(), title, due_date: due, done: false, _pending: true };
  state.deadlines.push(temp);
  titleEl.value = ""; dateEl.value = "";
  titleEl.disabled = true; dateEl.disabled = true; btn.disabled = true;
  renderDeadlines();
  try {
    const rows = await sbInsert("deadlines", { title, due_date: due, done: false });
    const saved = rows && rows[0] ? rows[0] : null;
    const idx = state.deadlines.indexOf(temp);
    if (saved && idx !== -1) state.deadlines[idx] = saved;
    saveCache(); hideBanner();
  } catch (err) {
    console.error(err);
    state.deadlines = state.deadlines.filter((x) => x !== temp);
    showBanner("Не удалось добавить дедлайн. Попробуй ещё раз.");
  } finally {
    titleEl.disabled = false; dateEl.disabled = false; btn.disabled = false;
    renderDeadlines(); titleEl.focus();
  }
}

/* ── утилиты ───────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function showBanner(msg) { const b = document.getElementById("banner"); b.textContent = msg; b.classList.remove("hidden"); }
function hideBanner() { document.getElementById("banner").classList.add("hidden"); }

const APP_NAME = (typeof window !== "undefined" && typeof window.APP_NAME !== "undefined") ? window.APP_NAME : "";

/* ── старт ─────────────────────────────────────────────────── */
document.getElementById("addBtn").onclick = addTask;
document.getElementById("addInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });
document.getElementById("dlBtn").onclick = addDeadline;
document.getElementById("dlTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") addDeadline(); });

// Модалка описания: крестик и клик по затемнённому фону (но не по самой карточке).
document.getElementById("modalClose").onclick = closeModal;
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ── навигация по дням: кнопки, «Сегодня», обновление ──
document.getElementById("navPrev").onclick = () => shiftDay(-1);
document.getElementById("navNext").onclick = () => shiftDay(1);
document.getElementById("todayBtn").onclick = goToday;
document.getElementById("refreshBtn").onclick = () => { if (!state.loading) load(); };

// стрелки клавиатуры (десктоп) — если фокус не в поле ввода и модалка закрыта
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const t = e.target;
  if (t && t.closest && t.closest("input,select,textarea")) return;
  if (!document.getElementById("modal").classList.contains("hidden")) return;
  if (e.key === "ArrowLeft") shiftDay(-1); else shiftDay(1);
});

// свайп влево/вправо (мобильный) — листает дни
let swipe = null;
document.addEventListener("touchstart", (e) => {
  if (drag || e.touches.length !== 1) { swipe = null; return; }
  const t = e.touches[0];
  if (t.target.closest && t.target.closest("input,select,textarea,button,.grip,.modal")) { swipe = null; return; }
  swipe = { x: t.clientX, y: t.clientY };
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!swipe || drag) { swipe = null; return; }
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
    if (dx < 0) shiftDay(1); else shiftDay(-1);   // влево → следующий, вправо → предыдущий
  }
}, { passive: true });

// ── переключатель светлой/тёмной темы ──
// Начальную тему уже выставил inline-скрипт в <head> (по сохранённому выбору
// или системной). Здесь — только ручное переключение и синхронизация с системой.
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", t === "light" ? "#f3efe6" : "#14131f");
}
document.getElementById("themeToggle").onclick = () => {
  const t = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  applyTheme(t);
  try { localStorage.setItem("myday-theme", t); } catch { /* приватный режим */ }
};
// Пока пользователь не выбрал тему вручную — следуем системной.
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
    try { if (localStorage.getItem("myday-theme")) return; } catch { return; }
    applyTheme(e.matches ? "light" : "dark");
  });
}

// Сразу рисуем последнее сохранённое за сегодня (мгновенный старт), затем обновляем из сети.
(function hydrateFromCache() {
  const c = loadCache();
  if (c && c.view === state.date) {   // кэш только для сегодняшнего дня
    state.day = (c.day && c.day.date === state.date) ? c.day : null;
    state.today = state.day ? state.day.timeline : null;
    state.weather = c.weather || null;
    state.tasks = Array.isArray(c.tasks) ? c.tasks : [];
    state.deadlines = Array.isArray(c.deadlines) ? c.deadlines : [];
    state.lastRefresh = c.lastRefresh || null;
    state.hydrated = true;
    render();
  }
})();

// Каждую минуту: смена суток (Алматы) → перечитать; иначе двигать маркер «сейчас».
setInterval(() => {
  const t = todayISO();
  if (t !== state.date) {
    const wasToday = state.view === state.date;
    state.date = t;
    if (wasToday) state.view = t;
    load();
  } else {
    renderHeader(); renderNowNext(); renderPlan();  // двигаем «сейчас»/«сейчас/дальше»
  }
}, 60000);

load();

// Service worker для мгновенной загрузки оболочки и офлайна.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  // если сеть вернулась — обновим данные
  window.addEventListener("online", () => load());
}
