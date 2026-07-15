-- ─────────────────────────────────────────────────────────────
-- «Мой день» — миграция под расширения (перенос задач, дедлайны,
-- отметка свежести). Вставь целиком в Supabase → SQL Editor → Run.
-- Идемпотентно: безопасно запускать повторно.
-- ─────────────────────────────────────────────────────────────

-- Для gen_random_uuid() (если ещё не включено)
create extension if not exists pgcrypto;

-- 2) Перенос невыполненных дел: флаг «перенесено»
alter table public.tasks
  add column if not exists carried_over boolean not null default false;

-- 4) Отметка свежести дня
alter table public.days
  add column if not exists updated_at timestamptz;

-- 3) Дедлайны — постоянный список, не привязан к дню
create table if not exists public.deadlines (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  due_date   date not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists deadlines_due_idx on public.deadlines (due_date);

-- RLS + политики для роли anon (как у days/tasks)
alter table public.deadlines enable row level security;
drop policy if exists "anon full access deadlines" on public.deadlines;
create policy "anon full access deadlines"
  on public.deadlines
  for all
  to anon
  using (true)
  with check (true);
