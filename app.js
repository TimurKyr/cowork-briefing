/* ─────────────────────────────────────────────────────────────
   «Мой день» — чтение и запись данных в Supabase.
   Тянет строку `days`, задачи `tasks` (сегодняшние + невыполненные
   с прошлых дат) и дедлайны `deadlines`, рендерит их и пишет
   изменения обратно. Данные на сегодня каждое утро перезаписывает
   агент (Cowork).

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

/* ── состояние + локальный кэш ─────────────────────────────── */
const CACHE_KEY = "myday-cache-v1";
const state = {
  date: todayISO(),
  day: null,          // строка days (или null)
  tasks: [],          // сегодняшние + перенесённые
  deadlines: [],      // незакрытые дедлайны
  offline: false,     // последняя загрузка не удалась из-за сети → показываем кэш
  hydrated: false,    // отрисовали хоть раз из кэша/сети
};

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      date: state.date, day: state.day, tasks: state.tasks, deadlines: state.deadlines, savedAt: Date.now(),
    }));
  } catch { /* приватный режим / нет места — не критично */ }
}
function loadCache() {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

/* ── загрузка ──────────────────────────────────────────────── */
async function load() {
  if (!SB || !KEY) {
    showBanner("Не заполнен config.js (SUPABASE_URL / SUPABASE_ANON_KEY). Открой config.js и вставь ключи из Supabase.");
    render();
    return;
  }
  const date = state.date;
  try {
    const [days, tasks, deadlines] = await Promise.all([
      sbGet(`days?date=eq.${date}&limit=1`),
      // сегодняшние ИЛИ невыполненные с прошлых дат — видно сразу, не дожидаясь агента
      sbGet(`tasks?or=(date.eq.${date},and(date.lt.${date},done.eq.false))&order=date.asc,created_at.asc`),
      sbGet(`deadlines?done=eq.false&order=due_date.asc,created_at.asc`),
    ]);
    state.day = days && days.length ? days[0] : null;
    state.tasks = Array.isArray(tasks) ? tasks : [];
    state.deadlines = Array.isArray(deadlines) ? deadlines : [];
    state.offline = false;
    state.hydrated = true;
    saveCache();
    hideBanner();
    render();
  } catch (err) {
    console.error(err);
    // Сетевой сбой (offline) → показываем последнее известное из кэша без красного баннера.
    if (err instanceof TypeError) {
      state.offline = true;
      if (state.hydrated) { render(); }
      else { render(); }
    } else {
      // Реальная ошибка API (RLS, неверный ключ, отсутствует таблица) — показываем баннер.
      showBanner("Не удалось получить данные из Supabase. Проверь URL/ключ, миграцию и политики RLS. Подробности — в консоли.");
      render();
    }
  }
}

/* ── рендер ────────────────────────────────────────────────── */
function render() {
  renderHeader();
  renderNowNext();
  renderDeadlines();
  renderPlan();
  renderList();
}

function renderHeader() {
  document.getElementById("dateline").textContent = dateLabel(state.date);

  const nameEl = document.getElementById("name");
  const greetingEl = document.getElementById("greeting");
  const g = greetingWord();
  greetingEl.firstChild.textContent = APP_NAME ? g + "," : g;
  nameEl.textContent = APP_NAME || "";

  // subline: погода
  const sub = document.getElementById("subline");
  const parts = [];
  if (state.day && state.day.weather) parts.push(state.day.weather);
  sub.innerHTML = parts.map((s, i) => (i ? '<span class="dot"></span>' : "") + `<span>${escapeHtml(s)}</span>`).join("");

  // часы «сейчас»
  const { h, m } = almatyHM();
  document.getElementById("now-clock").textContent = "сейчас " + pad(h) + ":" + pad(m);

  // футер: свежесть + офлайн
  const footer = document.getElementById("footer");
  const upd = state.day && state.day.updated_at ? fmtAlmatyTime(state.day.updated_at) : null;
  const isToday = state.day && state.day.date === state.date;
  let base = (isToday && upd) ? `обновлено в ${upd}` : "ещё не обновлялось сегодня";
  if (state.offline) base += " · офлайн";
  footer.textContent = base;
}

// Строка «сейчас / дальше»
function renderNowNext() {
  const el = document.getElementById("nownext");
  const blocks = (state.day && Array.isArray(state.day.timeline)) ? state.day.timeline : [];
  if (!blocks.length) { el.classList.add("hidden"); return; }

  const now = nowMin();
  const sorted = blocks.slice().sort((a, b) => toMin(a.start || "00:00") - toMin(b.start || "00:00"));
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
  const focusCard = document.getElementById("focusCard");
  const planHead = document.getElementById("planHead");
  const timeline = document.getElementById("timeline");
  const note = document.getElementById("note");

  if (!state.day) {
    empty.classList.remove("hidden");
    focusCard.classList.add("hidden");
    planHead.classList.add("hidden");
    timeline.classList.add("hidden");
    note.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  focusCard.classList.remove("hidden");
  planHead.classList.remove("hidden");
  timeline.classList.remove("hidden");

  document.getElementById("focus").textContent = state.day.focus || "—";

  if (state.day.note) { note.textContent = state.day.note; note.classList.remove("hidden"); }
  else { note.classList.add("hidden"); }

  const now = nowMin();
  timeline.innerHTML = "";
  const blocks = Array.isArray(state.day.timeline) ? state.day.timeline : [];
  if (!blocks.length) {
    timeline.innerHTML = `<div class="empty" style="margin:0">На сегодня событий в календаре нет — свободный день.</div>`;
    return;
  }
  blocks.slice().sort((a, b) => toMin(a.start || "00:00") - toMin(b.start || "00:00")).forEach((b) => {
    const s = toMin(b.start || "00:00");
    const e = toMin(b.end || b.start || "00:00");
    const stateName = now >= e ? "past" : (now >= s && now < e ? "now" : "future");
    const el = document.createElement("div");
    el.className = "block";
    el.dataset.state = stateName;
    el.style.setProperty("--tag", `var(--${kindVar(b.kind)})`);
    const loc = b.location
      ? `<div class="b-loc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(b.location)}</div>`
      : "";
    const range = b.end ? `${b.start}–${b.end}` : `${b.start}`;
    el.innerHTML = `
      <div class="time">${escapeHtml(b.start || "")}</div>
      <div class="body">
        <div class="b-title">${escapeHtml(b.title || "")}</div>
        ${loc}
        <div class="b-range">${escapeHtml(range)}</div>
        ${stateName === "now" ? `<div class="now-flag"><span class="now-pulse"></span>сейчас</div>` : ""}
      </div>`;
    timeline.appendChild(el);
  });
}

function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  state.tasks.forEach((task) => {
    const carried = task.date && task.date < state.date;
    const el = document.createElement("div");
    el.className = "item" + (task.done ? " done" : "") + (task._pending ? " pending" : "");
    el.innerHTML =
      `<div class="box"><svg viewBox="0 0 24 24" fill="none" stroke="#14131f" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg></div>
       <div class="t-wrap"><div class="t"></div>${carried ? `<div class="carried">⤷ с вчера</div>` : ""}</div>`;
    el.querySelector(".t").textContent = task.text;
    el.onclick = () => toggle(task);
    list.appendChild(el);
  });
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.done).length;
  document.getElementById("progress").textContent = `${done} / ${total}`;
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
  const v = inp.value.trim();
  if (!v) return;
  if (!SB || !KEY) { showBanner("Нельзя добавить дело: не заполнен config.js."); return; }

  const temp = { id: "temp-" + Date.now(), date: state.date, text: v, done: false, carried_over: false, _pending: true };
  state.tasks.push(temp);
  inp.value = ""; inp.disabled = true; btn.disabled = true;
  renderList();
  try {
    const rows = await sbInsert("tasks", { date: state.date, text: v, done: false, carried_over: false });
    const saved = rows && rows[0] ? rows[0] : null;
    const idx = state.tasks.indexOf(temp);
    if (saved && idx !== -1) state.tasks[idx] = saved;
    saveCache(); hideBanner();
  } catch (err) {
    console.error(err);
    state.tasks = state.tasks.filter((t) => t !== temp);
    showBanner("Не удалось добавить дело. Попробуй ещё раз.");
  } finally {
    inp.disabled = false; btn.disabled = false; renderList(); inp.focus();
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

// Сразу рисуем последнее сохранённое (мгновенный старт), затем тихо обновляем из сети.
(function hydrateFromCache() {
  const c = loadCache();
  if (c) {
    state.day = c.day || null;
    state.tasks = Array.isArray(c.tasks) ? c.tasks : [];
    state.deadlines = Array.isArray(c.deadlines) ? c.deadlines : [];
    state.hydrated = true;
    render();
  }
})();

// Каждую минуту: если сменились сутки (Алматы) — перечитываем; иначе двигаем «сейчас».
setInterval(() => {
  const t = todayISO();
  if (t !== state.date) { state.date = t; load(); }
  else { renderHeader(); renderNowNext(); renderPlan(); renderDeadlines(); }
}, 60000);

load();

// Service worker для мгновенной загрузки оболочки и офлайна.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  // если сеть вернулась — обновим данные
  window.addEventListener("online", () => load());
}
