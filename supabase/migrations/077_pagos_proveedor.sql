-- Módulo de Tesorería, paso 4/8: "Pagos a Proveedores". Deuda derivada (sin
-- tabla de saldo, mismo criterio que Cta. Corriente): SUM(movimiento_items.subtotal)
-- de movimientos tipo='entrega' con ese proveedor_id (ver 076) en esa
-- sucursal, MENOS SUM(pagos_proveedor.monto_efectivo + monto_billetera).
-- movimiento_id es opcional (decisión del usuario): un pago puede ser
-- genérico "a cuenta" sin atarse a una entrega puntual.

create table public.pagos_proveedor (
  id              uuid primary key default gen_random_uuid(),
  proveedor_id    uuid not null references public.proveedores(id) on delete restrict,
  sucursal_id     uuid not null references public.sucursales(id) on delete cascade,
  fecha_pago      date not null,
  monto_efectivo  numeric not null default 0 check (monto_efectivo >= 0),
  monto_billetera numeric not null default 0 check (monto_billetera >= 0),
  movimiento_id   uuid references public.movimientos(id) on delete set null,
  nota            text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint pagos_proveedor_monto_positivo check (monto_efectivo + monto_billetera > 0)
);

create index pagos_proveedor_sucursal_idx  on public.pagos_proveedor (sucursal_id);
create index pagos_proveedor_proveedor_idx on public.pagos_proveedor (proveedor_id);

alter table public.pagos_proveedor enable row level security;

-- Mismo nivel que cta_corriente_pagos (decisión del usuario: admin + el
-- encargado de esa sucursal, no admin-only como gastos -- quien recibe la
-- entrega y le paga al proveedor en el día a día suele ser el encargado).
create policy "pagos_proveedor_select" on public.pagos_proveedor for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

create policy "pagos_proveedor_write" on public.pagos_proveedor for all to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
  )
  with check (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
  );

grant select, insert, update, delete on public.pagos_proveedor to authenticated;
