#!/usr/bin/env python3
"""
push_day.py — локальная проверка связки «база ↔ сайт».

Делает ровно то же, что каждое утро будет делать агент Cowork:
upsert строки в таблицу `days` за сегодня (по PK date, merge-duplicates)
и, по желанию, добавляет пару демо-задач в `tasks`.

Запуск:
    # ключи можно взять из config.js или задать переменными окружения
    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_ANON_KEY="ey..."
    python3 push_day.py

    # добавить ещё и демо-задачи в чеклист:
    python3 push_day.py --tasks

Только anon-ключ. Никакого service_role. Только HTTP, без зависимостей.
"""
import os
import re
import sys
import json
import datetime
import urllib.request
import urllib.error


def load_config():
    """Берём URL и anon-ключ из окружения, иначе парсим config.js рядом."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if url and key:
        return url.rstrip("/"), key

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


def post(url, key, path, payload, prefer):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def main():
    url, key = load_config()
    today = datetime.date.today().isoformat()

    day = {
        "date": today,
        "focus": "Досдать лабу по базам данных до 18:00",
        "note": "Демо-строка из push_day.py. Если ты видишь это на сайте — связка работает.",
        "weather": "переменная облачность, +24°",
        "timeline": [
            {"start": "08:00", "end": "12:00", "title": "Работа — Nomad Insurance",
             "location": "офис", "kind": "work"},
            {"start": "12:30", "end": "14:00", "title": "Обед и отдых", "kind": "break"},
            {"start": "14:00", "end": "16:00", "title": "Учёба — лаба по БД",
             "location": "дом", "kind": "study"},
            {"start": "17:00", "end": "18:30", "title": "Теннис",
             "location": "корты Достык", "kind": "sport"},
            {"start": "20:00", "end": "21:00", "title": "Пианино", "kind": "hobby"},
        ],
    }

    # upsert по date: resolution=merge-duplicates перезапишет существующую строку
    status, text = post(url, key, "days", day, "resolution=merge-duplicates,return=representation")
    if status not in (200, 201):
        sys.exit(f"days upsert → {status}\n{text}")
    print(f"✓ days за {today} записана (HTTP {status})")

    if "--tasks" in sys.argv:
        tasks = [
            {"date": today, "text": "Досдать лабу по БД", "done": False},
            {"date": today, "text": "Ответить Жомарту по кампании", "done": False},
            {"date": today, "text": "Занести вчерашние траты", "done": False},
        ]
        status, text = post(url, key, "tasks", tasks, "return=representation")
        if status not in (200, 201):
            sys.exit(f"tasks insert → {status}\n{text}")
        print(f"✓ добавлено демо-задач: {len(json.loads(text))} (HTTP {status})")

    print("\nГотово. Открой сайт — данные за сегодня должны появиться.")


if __name__ == "__main__":
    main()
