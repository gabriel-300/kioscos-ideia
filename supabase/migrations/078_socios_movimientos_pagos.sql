-- Módulo de Tesorería, paso 5/8: "Socios" (retiros y devoluciones). Mirror
-- deliberado del patrón de Cta. Corriente/cta_corriente_pagos, pero SIN tabla
-- de items -- un retiro de socio es un monto único, no un carrito de
-- productos, así que movimientos_socio.monto alcanza.
--
-- tipo distingue "retiro_temporal" (préstamo -- genera saldo pendiente, se
-- espera devolución) de "retiro_ganancias" (reparto de utilidades real --
-- decisión del usuario: NO genera deuda a devolver, queda solo para el
-- historial).

create table public.movimientos_socio (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  uuid not null references public.sucursales(id) on delete cascade,
  socio_id     uuid not null references public.profiles(id) on delete restrict,
  tipo         text not null check (tipo in ('retiro_temporal', 'retiro_ganancias')),
  monto        numeric not null check (monto > 0),
  fecha        date not null,
  notas        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index movimientos_socio_sucursal_idx on public.movimientos_socio (sucursal_id, socio_id);

-- Devoluciones: mismo split efectivo/billetera que pagos_proveedor/cta_corriente_pagos.
create table public.pagos_socio (
  id              uuid primary key default gen_random_uuid(),
  sucursal_id     uuid not null references public.sucursales(id) on delete cascade,
  socio_id        uuid not null references public.profiles(id) on delete restrict,
  monto_efectivo  numeric not null default 0 check (monto_efectivo >= 0),
  monto_billetera numeric not null default 0 check (monto_billetera >= 0),
  fecha           date not null,
  notas           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint pagos_socio_monto_positivo check (monto_efectivo + monto_billetera > 0)
);

create index pagos_socio_sucursal_idx on public.pagos_socio (sucursal_id, socio_id);

alter table public.movimientos_socio enable row level security;
alter table public.pagos_socio       enable row level security;

-- Mismo shape que cta_corriente_pagos, sin excepción (pedido explícito del
-- usuario: mirror exacto del patrón de Cta. Corriente).
create policy "movimientos_socio_select" on public.movimientos_socio for select to authenticated
  using (is_admin() or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()) or sucursal_id = my_sucursal_id());
create policy "movimientos_socio_write" on public.movimientos_socio for all to authenticated
  using (is_admin() or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()))
  with check (is_admin() or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()));

create policy "pagos_socio_select" on public.pagos_socio for select to authenticated
  using (is_admin() or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()) or sucursal_id = my_sucursal_id());
create policy "pagos_socio_write" on public.pagos_socio for all to authenticated
  using (is_admin() or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()))
  with check (is_admin() or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()));

grant select, insert, update, delete on public.movimientos_socio to authenticated;
grant select, insert, update, delete on public.pagos_socio       to authenticated;
