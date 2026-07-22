-- ─────────────────────────────────────────────────────────────
-- «Мой день» — приоритеты задач (high / medium / low) и ручной
-- порядок внутри приоритета. Вставь целиком в Supabase → SQL Editor.
-- Идемпотентно: безопасно запускать повторно.
-- ─────────────────────────────────────────────────────────────

-- 1) Приоритет. Все существующие задачи получают 'low' — как и просили.
alter table public.tasks
  add column if not exists priority text not null default 'low';

-- Допустимые значения
do $$
begin
  alter table public.tasks
    add constraint tasks_priority_check check (priority in ('high','medium','low'));
exception
  when duplicate_object then null;
end $$;

-- 2) Позиция для ручной сортировки внутри приоритета.
--    double precision — чтобы вставлять «между» соседями без перенумерации.
alter table public.tasks
  add column if not exists position double precision;

-- Существующим задачам раздаём позиции по времени создания,
-- чтобы текущий порядок в списке сохранился.
update public.tasks
   set position = extract(epoch from created_at)
 where position is null;

alter table public.tasks alter column position set default 0;
alter table public.tasks alter column position set not null;

-- 3) Индекс под выборку и сортировку списка
create index if not exists tasks_date_priority_position_idx
  on public.tasks (date, priority, position);
