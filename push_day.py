#!/usr/bin/env python3
"""
push_day.py — ЛЕГАСИ, из предыдущей версии проекта.

Эта версия сайта больше НЕ читает data/today.json — день теперь загружается
из Google Drive (файл day-YYYY-MM-DD.json, который создаёт агент). Этот скрипт
писал data/today.json для старой схемы (GitHub-коммит агентом) и сейчас
никак не влияет на то, что видит сайт. Оставлен только для истории.

Чтобы проверить чтение из Drive вручную — см. README.md, раздел
«Проверить канал Drive → сайт вручную».
"""
import os
import json
from datetime import datetime, timezone, timedelta

ALMATY = timezone(timedelta(hours=5))  # Казахстан круглый год UTC+5
TODAY_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "today.json")


def main():
    now = datetime.now(ALMATY)
    today = now.date().isoformat()

    day = {
        "date": today,
        "focus": "Досдать лабу по базам данных до 18:00",
        "note": "Демо-день из push_day.py. Видишь его на сайте — файл читается верно.",
        "weather": "переменная облачность, +24°",
        "updated_at": now.isoformat(timespec="seconds"),
        "timeline": [
            {"start": "08:00", "end": "12:00", "title": "Работа — Nomad Insurance", "location": "офис, Абая 12", "kind": "work",
             "colorId": 7,  # Peacock #039be5 — перекрывает цвет по kind
             "description": "Стендап в 09:30 по Zoom.\nЗакрыть тикет NB-142 и собрать отчёт по кампании.\nПеред обедом — созвон с Жомартом."},
            {"start": "12:30", "end": "14:00", "title": "Обед и отдых", "kind": "break"},
            {"start": "14:00", "end": "16:00", "title": "Учёба — лаба по БД", "location": "дом", "kind": "study",
             "colorId": 11,  # Tomato #d60000
             "description": "Тема: индексы и планы запросов.\nСдать лабу №5 до 18:00 — не забыть приложить EXPLAIN ANALYZE."},
            {"start": "17:00", "end": "18:30", "title": "Теннис", "location": "корты Достык", "kind": "sport"},
            {"start": "20:00", "end": "21:00", "title": "Пианино", "kind": "hobby"},
        ],
    }

    os.makedirs(os.path.dirname(TODAY_JSON), exist_ok=True)
    with open(TODAY_JSON, "w", encoding="utf-8") as f:
        json.dump(day, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"✓ data/today.json перезаписан демо-данными за {today} (updated_at {day['updated_at']})")
    print("Открой сайт локально (python3 -m http.server 8000) — секция дня покажет эти данные.")


if __name__ == "__main__":
    main()
