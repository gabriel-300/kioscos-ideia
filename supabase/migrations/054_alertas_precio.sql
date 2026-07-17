-- Alerta de cambio de precio en entregas: cuando el precio cargado en una
-- entrega difiere del costo actual del producto, queda registrado acá para
-- que el admin lo revise (actualizar el costo o ignorarlo) -- solo admin
-- ve costos en todo el sistema, mismo criterio acá.

create table public.alertas_precio (
  id                 uuid primary key default gen_random_uuid(),
  movimiento_id      uuid not null references public.movimientos(id) on delete cascade,
  product_id         uuid not null references public.products(id),
  proveedor          text,
  costo_anterior     numeric not null,
  costo_nuevo        numeric not null,
  revisado_por       uuid references auth.users(id),
  revisado_en        timestamptz,
  costo_actualizado  boolean not null default false,
  nota_admin         text,
  created_at         timestamptz not null default now()
);

create index alertas_precio_pendientes_idx on public.alertas_precio (product_id)
  where revisado_por is null;

alter table public.alertas_precio enable row level security;

create policy "admin_all_alertas_precio" on public.alertas_precio
  for all to authenticated
  using (is_admin()) with check (is_admin());
