/* ─────────────────────────────────────────────────────────────
   «Мой день» — чтение и запись данных в Supabase.
   Разметку и стили трогать не нужно: этот файл только тянет
   строку `days` за сегодня и задачи `tasks`, рендерит их и
   пишет изменения чеклиста обратно.
   Данные на сегодня каждое утро перезаписывает агент (Cowork).
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

// Локальная сегодняшняя дата в формате YYYY-MM-DD (без сдвига по UTC).
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function sbGet(path) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: restHeaders() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method: "PATCH",
    headers: restHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbInsert(path, body) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method: "POST",
    headers: restHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

/* ── время ─────────────────────────────────────────────────── */
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
function pad(n) { return String(n).padStart(2, "0"); }

const KNOWN_KINDS = ["work", "study", "sport", "break", "hobby", "other"];
const kindVar = (k) => (KNOWN_KINDS.includes(k) ? k : "other");

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function dateLabel(d) {
  const wd = WEEKDAYS[d.getDay()];
  return `${wd.charAt(0).toUpperCase() + wd.slice(1)}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function greetingWord(d) {
  const h = d.getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

/* ── состояние ─────────────────────────────────────────────── */
const state = {
  date: todayISO(),
  day: null,      // строка из таблицы days (или null)
  tasks: [],      // массив строк tasks
};

/* ── загрузка ──────────────────────────────────────────────── */
async function load() {
  if (!SB || !KEY) {
    showBanner("Не заполнен config.js (SUPABASE_URL / SUPABASE_ANON_KEY). Открой config.js и вставь ключи из Supabase.");
    render();
    return;
  }
  try {
    const date = state.date;
    const [days, tasks] = await Promise.all([
      sbGet(`days?date=eq.${date}&limit=1`),
      sbGet(`tasks?date=eq.${date}&order=created_at.asc`),
    ]);
    state.day = days && days.length ? days[0] : null;
    state.tasks = Array.isArray(tasks) ? tasks : [];
    hideBanner();
    render();
  } catch (err) {
    console.error(err);
    showBanner("Не удалось получить данные из Supabase. Проверь URL/ключ и политики RLS. Подробности — в консоли.");
    render();
  }
}

/* ── рендер ────────────────────────────────────────────────── */
function render() {
  renderHeader();
  renderPlan();
  renderList();
}

function renderHeader() {
  const now = new Date();
  document.getElementById("dateline").textContent =
    (state.day && state.day.date) ? dateLabel(new Date(state.day.date + "T00:00:00")) : dateLabel(now);

  // Имя берём из фокуса? Нет — имя не хранится в БД; оставляем приветствие без имени, если строки нет.
  const nameEl = document.getElementById("name");
  const greetingEl = document.getElementById("greeting");
  greetingEl.firstChild.textContent = greetingWord(now) + ",";
  nameEl.textContent = APP_NAME || "";
  if (!APP_NAME) {
    // без имени — убираем перенос строки и хвостовую запятую
    greetingEl.firstChild.textContent = greetingWord(now);
    nameEl.textContent = "";
  }

  // subline: погода + любые доп. подписи
  const sub = document.getElementById("subline");
  const parts = [];
  if (state.day && state.day.weather) parts.push(state.day.weather);
  sub.innerHTML = parts
    .map((s, i) => (i ? '<span class="dot"></span>' : "") + `<span>${escapeHtml(s)}</span>`)
    .join("");

  // часы «сейчас»
  document.getElementById("now-clock").textContent = "сейчас " + pad(now.getHours()) + ":" + pad(now.getMinutes());

  // footer
  const footer = document.getElementById("footer");
  footer.textContent = state.day ? "план на сегодня" : "ожидаем утреннее обновление";
}

function renderPlan() {
  const empty = document.getElementById("emptyState");
  const focusCard = document.getElementById("focusCard");
  const planHead = document.getElementById("planHead");
  const timeline = document.getElementById("timeline");
  const note = document.getElementById("note");

  if (!state.day) {
    // аккуратный пустой стейт — не ошибка
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

  if (state.day.note) {
    note.textContent = state.day.note;
    note.classList.remove("hidden");
  } else {
    note.classList.add("hidden");
  }

  const now = nowMin();
  const tl = timeline;
  tl.innerHTML = "";
  const blocks = Array.isArray(state.day.timeline) ? state.day.timeline : [];
  if (!blocks.length) {
    tl.innerHTML = `<div class="empty" style="margin:0">На сегодня событий в календаре нет — свободный день.</div>`;
    return;
  }
  blocks
    .slice()
    .sort((a, b) => toMin(a.start || "00:00") - toMin(b.start || "00:00"))
    .forEach((b) => {
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
      tl.appendChild(el);
    });
}

function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  state.tasks.forEach((task) => {
    const el = document.createElement("div");
    el.className = "item" + (task.done ? " done" : "") + (task._pending ? " pending" : "");
    el.innerHTML =
      `<div class="box"><svg viewBox="0 0 24 24" fill="none" stroke="#14131f" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg></div>
       <div class="t"></div>`;
    el.querySelector(".t").textContent = task.text;
    el.onclick = () => toggle(task);
    list.appendChild(el);
  });
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.done).length;
  document.getElementById("progress").textContent = `${done} / ${total}`;
}

/* ── действия ──────────────────────────────────────────────── */
// Оптимистичный UI: сразу переключаем, потом пишем UPDATE. При ошибке — откат.
async function toggle(task) {
  const prev = task.done;
  task.done = !prev;
  renderList();
  try {
    await sbPatch(`tasks?id=eq.${task.id}`, { done: task.done });
  } catch (err) {
    console.error(err);
    task.done = prev; // откат
    renderList();
    showBanner("Не удалось сохранить отметку. Изменение отменено.");
  }
}

async function addTask() {
  const inp = document.getElementById("addInput");
  const btn = document.getElementById("addBtn");
  const v = inp.value.trim();
  if (!v) return;

  if (!SB || !KEY) { showBanner("Нельзя добавить дело: не заполнен config.js."); return; }

  // Оптимистично показываем задачу как «в процессе», пока не вернётся id.
  const temp = { id: "temp-" + Date.now(), text: v, done: false, _pending: true };
  state.tasks.push(temp);
  inp.value = "";
  inp.disabled = true; btn.disabled = true;
  renderList();

  try {
    const rows = await sbInsert("tasks", { date: state.date, text: v, done: false });
    const saved = rows && rows[0] ? rows[0] : null;
    const idx = state.tasks.indexOf(temp);
    if (saved && idx !== -1) state.tasks[idx] = saved;
    hideBanner();
  } catch (err) {
    console.error(err);
    state.tasks = state.tasks.filter((t) => t !== temp); // откат
    showBanner("Не удалось добавить дело. Попробуй ещё раз.");
  } finally {
    inp.disabled = false; btn.disabled = false;
    renderList();
    inp.focus();
  }
}

/* ── утилиты ───────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function showBanner(msg) {
  const b = document.getElementById("banner");
  b.textContent = msg;
  b.classList.remove("hidden");
}
function hideBanner() {
  document.getElementById("banner").classList.add("hidden");
}

// Имя для приветствия (можно поменять в config.js через APP_NAME; иначе пусто).
const APP_NAME = (typeof window !== "undefined" && typeof window.APP_NAME !== "undefined") ? window.APP_NAME : "";

/* ── старт ─────────────────────────────────────────────────── */
document.getElementById("addBtn").onclick = addTask;
document.getElementById("addInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });

// Если день сменился, пока вкладка висела открытой — перечитываем.
setInterval(() => {
  const t = todayISO();
  if (t !== state.date) { state.date = t; load(); }
  renderHeader();
  renderPlan(); // двигаем маркер «сейчас»
}, 60000);

load();

// Регистрируем service worker для установки на домашний экран / офлайн-кэша.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
