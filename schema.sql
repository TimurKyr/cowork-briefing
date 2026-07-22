-- ─────────────────────────────────────────────────────────────
-- «Мой день» — схема Supabase.
-- Вставь целиком в Supabase → SQL Editor → New query → Run.
--
-- ВАЖНО про безопасность:
-- Ниже включён RLS и добавлены политики, разрешающие роли `anon`
-- полный доступ (select/insert/update/delete) к обеим таблицам.
-- Это осознанно — приложение личное, ходит только с anon-ключом,
-- своего сервера нет. Любой, кто знает URL+anon-ключ, сможет читать
-- и менять эти данные. Для личного дашборда это приемлемо; не храни
-- здесь ничего чувствительного.
-- ─────────────────────────────────────────────────────────────

-- Для gen_random_uuid()
create extension if not exists pgcrypto;

-- ── Таблица days: одна строка на дату ─────────────────────────
create table if not exists public.days (
  date       date primary key,
  focus      text,
  note       text,
  weather    text,
  timeline   jsonb not null default '[]'::jsonb,
  -- timeline — массив объектов: {start, end, title, location, kind}
  -- пример: [{"start":"09:00","end":"10:00","title":"Созвон","location":"Zoom","kind":"work"}]
  updated_at timestamptz   -- когда агент/скрипт последний раз обновил день
);

-- ── Таблица tasks: чеклист ────────────────────────────────────
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  text         text not null,
  done         boolean not null default false,
  carried_over boolean not null default false,  -- перенесено с прошлого дня
  priority     text not null default 'low'
                 check (priority in ('high','medium','low')),
  position     double precision not null default 0,  -- ручной порядок внутри приоритета
  created_at   timestamptz not null default now()
);

create index if not exists tasks_date_idx on public.tasks (date);
create index if not exists tasks_date_priority_position_idx
  on public.tasks (date, priority, position);

-- ── Таблица deadlines: постоянный список дедлайнов ────────────
create table if not exists public.deadlines (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  due_date   date not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists deadlines_due_idx on public.deadlines (due_date);

-- ── RLS ───────────────────────────────────────────────────────
alter table public.days      enable row level security;
alter table public.tasks     enable row level security;
alter table public.deadlines enable row level security;

-- Политики для роли anon. Пересоздаём идемпотентно.
drop policy if exists "anon full access days"      on public.days;
drop policy if exists "anon full access tasks"     on public.tasks;
drop policy if exists "anon full access deadlines" on public.deadlines;

create policy "anon full access days"
  on public.days
  for all
  to anon
  using (true)
  with check (true);

create policy "anon full access tasks"
  on public.tasks
  for all
  to anon
  using (true)
  with check (true);

create policy "anon full access deadlines"
  on public.deadlines
  for all
  to anon
  using (true)
  with check (true);

-- (опционально) те же права для авторизованных пользователей,
-- если позже добавишь вход. Пока можно не запускать.
-- create policy "auth full access days"  on public.days  for all to authenticated using (true) with check (true);
-- create policy "auth full access tasks" on public.tasks for all to authenticated using (true) with check (true);
