/* ─────────────────────────────────────────────────────────────
   «Мой день» — два источника данных.

   • Секция дня (day) — читается из Google Drive. Агент (Cowork) не
     умеет обновлять существующие файлы, только создавать новые —
     поэтому каждое утро он СОЗДАЁТ отдельный файл day-YYYY-MM-DD.json
     (за сегодняшнюю дату) в заданной папке Drive. Сайт каждый раз
     ищет по имени файл за сегодня через Google Drive API (files.list
     по папке+имени, затем files.get?alt=media) и читает его целиком.
     Старые day-*.json просто остаются в папке — это ожидаемо.
   • Задачи `tasks` и дедлайны `deadlines` — по-прежнему в Supabase:
     их читает и пишет браузер (у него доступ к supabase.co есть).

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

/* ── день из Google Drive ─────────────────────────────────────
   Файл называется day-YYYY-MM-DD.json и лежит в папке DRIVE_FOLDER_ID.
   Агент только СОЗДАЁТ новый файл на новую дату (не обновляет старый),
   поэтому сайт каждый раз ищет файл по имени заново — стабильного
   fileId заранее нет.

   Шаг 1 — files.list: находим id файла с нужным именем в нужной папке.
   Шаг 2 — files.get?alt=media: скачиваем содержимое по этому id.
   Оба запроса идут с restricted API-ключом (см. config.js), поэтому
   папка должна быть расшарена «Все, у кого есть ссылка — Читатель». */
const DRIVE_FOLDER = (typeof DRIVE_FOLDER_ID !== "undefined" && DRIVE_FOLDER_ID) ? DRIVE_FOLDER_ID : "";
const DRIVE_KEY = (typeof DRIVE_API_KEY !== "undefined" && DRIVE_API_KEY) ? DRIVE_API_KEY : "";

function driveListUrl(filename) {
  const q = `'${DRIVE_FOLDER}' in parents and name = '${filename}' and trashed = false`;
  const params = new URLSearchParams({
    q, fields: "files(id,name)", key: DRIVE_KEY, spaces: "drive",
  });
  return `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
}
function driveContentUrl(fileId) {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(DRIVE_KEY)}`;
}

async function fetchDay() {
  const filename = `day-${state.date}.json`;
  const listRes = await fetch(driveListUrl(filename), { cache: "no-store" });
  if (!listRes.ok) throw new HttpError(`Drive files.list → ${listRes.status}`, listRes.status);
  const listJson = await listRes.json();
  const file = listJson && Array.isArray(listJson.files) ? listJson.files[0] : null;
  if (!file) return null; // агент ещё не создал файл за сегодня

  const contentRes = await fetch(driveContentUrl(file.id), { cache: "no-store" });
  if (!contentRes.ok) throw new HttpError(`Drive files.get → ${contentRes.status}`, contentRes.status);
  return contentRes.json();
}

async function load() {
  const date = state.date;
  const haveSB = Boolean(SB && KEY);
  const haveDrive = Boolean(DRIVE_FOLDER && DRIVE_KEY);
  const banners = [];
  if (!haveSB) banners.push("SUPABASE_URL / SUPABASE_ANON_KEY — дела и дедлайны недоступны.");
  if (!haveDrive) banners.push("DRIVE_FOLDER_ID / DRIVE_API_KEY — день (фокус/погода/таймлайн) недоступен.");
  if (banners.length) showBanner("Не заполнен config.js: " + banners.join(" ") + " Открой config.js и вставь значения.");

  let netError = false;  // сетевой сбой (offline) хотя бы на одном запросе
  let apiError = false;  // реальная ошибка Supabase/Drive API

  // ── день из Google Drive (day-YYYY-MM-DD.json) ──
  if (haveDrive) {
    try {
      const dj = await fetchDay();
      // Показываем день, только если файл именно за сегодня (Алматы). Иначе — пустой
      // стейт «План на сегодня ещё формируется», а не устаревший день.
      state.day = (dj && dj.date === date) ? dj : null;
    } catch (err) {
      console.error(err);
      if (err instanceof TypeError) netError = true;  // нет сети — оставляем кэш дня
      else state.day = null;                          // нет файла / битый JSON — пустой стейт
    }
  }

  // ── задачи и дедлайны из Supabase (без изменений в логике) ──
  if (haveSB) {
    try {
      const [tasks, deadlines] = await Promise.all([
        // сегодняшние ИЛИ невыполненные с прошлых дат — видно сразу, не дожидаясь агента
        // Порядок задаём позицией: группировка по приоритету — на клиенте
        // (priority — text, серверная сортировка дала бы алфавитный порядок).
        sbGet(`tasks?or=(date.eq.${date},and(date.lt.${date},done.eq.false))&order=position.asc,created_at.asc`),
        sbGet(`deadlines?done=eq.false&order=due_date.asc,created_at.asc`),
      ]);
      state.tasks = Array.isArray(tasks) ? tasks : [];
      state.deadlines = Array.isArray(deadlines) ? deadlines : [];
    } catch (err) {
      console.error(err);
      // offline → оставляем кэш без красного баннера; иначе реальная ошибка API.
      if (err instanceof TypeError) netError = true;
      else apiError = true;
    }
  }

  state.offline = netError;
  state.hydrated = true;
  if (apiError) {
    showBanner("Не удалось получить дела/дедлайны из Supabase. Проверь URL/ключ, миграцию и политики RLS. Подробности — в консоли.");
  } else if (haveSB && haveDrive && !netError) {
    hideBanner();
  }
  saveCache();
  render();
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
  const carried = task.date && task.date < state.date;
  const el = document.createElement("div");
  el.className = "item" + (task.done ? " done" : "") + (task._pending ? " pending" : "");
  el.dataset.id = String(task.id);
  el.innerHTML =
    `<div class="box"><svg viewBox="0 0 24 24" fill="none" stroke="#14131f" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg></div>
     <div class="t-wrap"><div class="t"></div>${carried ? `<div class="carried">⤷ с вчера</div>` : ""}</div>
     <div class="grip" aria-label="Перетащить">${GRIP_SVG}</div>`;
  el.querySelector(".t").textContent = task.text;
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

// Сразу рисуем последнее сохранённое (мгновенный старт), затем тихо обновляем из сети.
(function hydrateFromCache() {
  const c = loadCache();
  if (c) {
    // День из кэша показываем только если он за сегодня — иначе пустой стейт.
    state.day = (c.day && c.day.date === state.date) ? c.day : null;
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
