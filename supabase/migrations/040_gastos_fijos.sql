-- Gastos fijos: plantillas de gastos recurrentes conocidos de antemano (alquiler,
-- sueldos, servicios) para poder calcular "comprometido" (lo que se sabe que hay
-- que pagar este mes y todavia no se pago) vs "ejecutado" (lo que ya esta en gastos).
-- Admin-only, mismo criterio que gastos (034).

create table public.gastos_fijos (
  id               uuid primary key default gen_random_uuid(),
  categoria        text not null check (categoria in ('mercaderia','sueldos','alquiler','servicios','otro')),
  descripcion      text not null,
  monto_estimado   numeric not null check (monto_estimado > 0),
  dia_vencimiento  smallint not null check (dia_vencimiento between 1 and 31),
  sucursal_id      uuid references public.sucursales(id) on delete set null,
  is_active        boolean not null default true,
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.gastos_fijos enable row level security;

create policy admin_all_gastos_fijos on public.gastos_fijos
  for all to authenticated
  using ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'))
  with check ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'));

create index gastos_fijos_activo_idx on public.gastos_fijos (is_active);

-- Vinculo: que gasto real "salda" que gasto fijo de que mes. Sin esto no hay forma
-- de saber si el alquiler de julio ya se pago o sigue comprometido.
alter table public.gastos add column gasto_fijo_id uuid references public.gastos_fijos(id) on delete set null;
alter table public.gastos add column updated_by uuid references auth.users(id) on delete set null;

create index gastos_gasto_fijo_id_idx on public.gastos (gasto_fijo_id);
