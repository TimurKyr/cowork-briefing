#!/usr/bin/env python3
"""
push_day.py — локальная проверка связки «база ↔ сайт».

Заливает демо-данные под ВСЕ элементы UI, чтобы сразу увидеть интерфейс:
  • строку days за сегодня (с updated_at = now);
  • пару обычных задач за сегодня + одну задачу «с вчера» (date = вчера, done=false);
  • два дедлайна (один сегодня, один через 2 дня).

Всё «сегодня/вчера» считается по Asia/Almaty (UTC+5) — как на сайте и у агента.
Перед вставкой скрипт удаляет свои прежние демо-строки (по известным текстам),
поэтому повторный запуск не плодит дубликаты.

Запуск:
    python3 push_day.py           # ключи берутся из config.js или из окружения

Только anon-ключ. Никакого service_role. Только HTTP, без зависимостей.
"""
import os
import re
import sys
import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

ALMATY = timezone(timedelta(hours=5))  # Казахстан круглый год UTC+5

# Тексты демо-строк — по ним же чистим перед повторной вставкой.
DEMO_TASKS_TODAY = ["Досдать лабу по БД", "Ответить Жомарту по кампании"]
DEMO_TASK_CARRIED = "Занести вчерашние траты (с вчера)"
DEMO_DEADLINES = ["Сдать проект по вебу", "Оплатить интернет"]


def load_config():
    """Берём URL и anon-ключ из окружения, иначе парсим config.js рядом."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not (url and key):
        cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.js")
        if os.path.exists(cfg):
            text = open(cfg, encoding="utf-8").read()
            if not url:
                m = re.search(r'SUPABASE_URL\s*=\s*["\']([^"\']+)["\']', text)
                url = m.group(1) if m else None
            if not key:
                m = re.search(r'SUPABASE_ANON_KEY\s*=\s*["\']([^"\']+)["\']', text)
                key = m.group(1) if m else None
    if not url or not key or "YOUR-" in (url + key):
        sys.exit("Нет SUPABASE_URL / SUPABASE_ANON_KEY. Заполни config.js или задай переменные окружения.")
    return url.rstrip("/"), key


def request(url, key, method, path, payload=None, prefer=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def q(val):
    """URL-энкод значения для PostgREST-фильтра."""
    return urllib.parse.quote(val, safe="")


def cleanup(url, key):
    """Удаляем прежние демо-строки, чтобы не плодить дубликаты."""
    for t in DEMO_TASKS_TODAY + [DEMO_TASK_CARRIED]:
        request(url, key, "DELETE", f"tasks?text=eq.{q(t)}")
    for t in DEMO_DEADLINES:
        request(url, key, "DELETE", f"deadlines?title=eq.{q(t)}")


def main():
    url, key = load_config()
    now = datetime.now(ALMATY)
    today = now.date().isoformat()
    yesterday = (now.date() - timedelta(days=1)).isoformat()
    in_two = (now.date() + timedelta(days=2)).isoformat()

    cleanup(url, key)

    # ── days (с updated_at) ──
    day = {
        "date": today,
        "focus": "Досдать лабу по базам данных до 18:00",
        "note": "Демо-строка из push_day.py. Видишь её на сайте — связка работает.",
        "weather": "переменная облачность, +24°",
        "updated_at": now.isoformat(),
        "timeline": [
            {"start": "08:00", "end": "12:00", "title": "Работа — Nomad Insurance", "location": "офис", "kind": "work"},
            {"start": "12:30", "end": "14:00", "title": "Обед и отдых", "kind": "break"},
            {"start": "14:00", "end": "16:00", "title": "Учёба — лаба по БД", "location": "дом", "kind": "study"},
            {"start": "17:00", "end": "18:30", "title": "Теннис", "location": "корты Достык", "kind": "sport"},
            {"start": "20:00", "end": "21:00", "title": "Пианино", "kind": "hobby"},
        ],
    }
    status, text = request(url, key, "POST", "days", day, "resolution=merge-duplicates,return=representation")
    if status not in (200, 201):
        sys.exit(f"days upsert → {status}\n{text}")
    print(f"✓ days за {today} записана, updated_at выставлен (HTTP {status})")

    # ── tasks: 2 сегодняшних + 1 «с вчера» ──
    tasks = [
        {"date": today, "text": DEMO_TASKS_TODAY[0], "done": False, "carried_over": False},
        {"date": today, "text": DEMO_TASKS_TODAY[1], "done": False, "carried_over": False},
        {"date": yesterday, "text": DEMO_TASK_CARRIED, "done": False, "carried_over": False},
    ]
    status, text = request(url, key, "POST", "tasks", tasks, "return=representation")
    if status not in (200, 201):
        sys.exit(f"tasks insert → {status}\n{text}")
    print(f"✓ задач добавлено: {len(json.loads(text))} (2 на сегодня + 1 «с вчера»)")

    # ── deadlines: сегодня и +2 дня ──
    deadlines = [
        {"title": DEMO_DEADLINES[0], "due_date": in_two, "done": False},
        {"title": DEMO_DEADLINES[1], "due_date": today, "done": False},
    ]
    status, text = request(url, key, "POST", "deadlines", deadlines, "return=representation")
    if status not in (200, 201):
        sys.exit(f"deadlines insert → {status}\n{text}")
    print(f"✓ дедлайнов добавлено: {len(json.loads(text))} (сегодня и через 2 дня)")

    print("\nГотово. Открой сайт — новый UI появится сразу с данными.")


if __name__ == "__main__":
    main()
