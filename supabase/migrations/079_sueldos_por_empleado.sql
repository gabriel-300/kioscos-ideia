-- Módulo de Tesorería, paso 6/8: extiende gastos (no la reemplaza) para
-- poder atribuir un gasto categoria='sueldos' a un empleado puntual y
-- marcarlo regular/extra. Aditiva y nullable, mismo patrón que gasto_fijo_id
-- en 040_gastos_fijos.sql. Sin cambio de RLS -- gastos sigue admin-only.

alter table public.gastos
  add column if not exists empleado_id uuid references public.profiles(id) on delete set null,
  add column if not exists tipo_sueldo  text check (tipo_sueldo in ('regular', 'extra'));

create index if not exists gastos_empleado_id_idx on public.gastos (empleado_id);
