-- Modulo financiero: registro de gastos (mercaderia/sueldos/alquiler/servicios/otro)
-- para poder cruzar contra los ingresos y saber el resultado del mes. Admin-only --
-- es informacion financiera sensible, mismo criterio que el costo de productos.
--
-- NOTA: ya aplicada directo contra la base el 2026-07-07 via MCP.

create table public.gastos (
  id           uuid primary key default gen_random_uuid(),
  categoria    text not null check (categoria in ('mercaderia','sueldos','alquiler','servicios','otro')),
  monto        numeric not null check (monto > 0),
  fecha        date not null,
  proveedor    text,
  sucursal_id  uuid references public.sucursales(id) on delete set null,
  notas        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

alter table public.gastos enable row level security;

create policy admin_all_gastos on public.gastos
  for all to authenticated
  using ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'))
  with check ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'));

create index gastos_fecha_idx on public.gastos (fecha);
