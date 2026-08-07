-- ============================================================
-- CONCILIACIÓN DE PAGOS CON MERCADO PAGO (QR + transferencias)
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Cuando falla la cámara y el cliente no puede escanear el QR, transfiere
-- en su lugar -- si transfiere al alias/CVU de la MISMA cuenta de Mercado
-- Pago (no a un banco genérico tipo Brubank, que no tiene API), esa
-- transferencia entra como un pago más de la cuenta (payment_type_id
-- "bank_transfer") y el webhook que ya recibe las confirmaciones de QR
-- también la recibe -- se amplía qué hace con lo que ya le llega, ver
-- 071_mercadopago_qr.sql.
-- ============================================================

create table if not exists public.mercadopago_transferencias_recibidas (
  id            uuid primary key default gen_random_uuid(),
  mp_payment_id text not null unique,
  monto         numeric(12,2) not null,
  recibido_en   timestamptz not null default now(),
  raw_payload   jsonb,
  movimiento_id uuid references public.movimientos(id) on delete set null,
  sucursal_id   uuid references public.sucursales(id) on delete set null,
  asignado_por  uuid references auth.users(id),
  asignado_en   timestamptz
);

create index if not exists mercadopago_transferencias_sin_asignar_idx
  on public.mercadopago_transferencias_recibidas (recibido_en) where movimiento_id is null;

alter table public.mercadopago_transferencias_recibidas enable row level security;

create policy "admin_all_mercadopago_transferencias" on public.mercadopago_transferencias_recibidas for all to authenticated
  using (is_admin()) with check (is_admin());
-- Sin sucursal_id asignado son visibles para cualquier staff (necesitan
-- verlas para poder vincularlas a una venta propia) -- una vez asignadas,
-- solo admin o el staff de esa sucursal.
create policy "staff_select_mercadopago_transferencias" on public.mercadopago_transferencias_recibidas for select to authenticated
  using (
    is_admin()
    or sucursal_id is null
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

-- Cierra el loop que faltaba para el QR también: hoy mercadopago_qr_orders
-- no guarda a qué venta terminó asociada una vez que el vendedor confirma
-- el cobro -- sin esto, el informe de conciliación no podría cruzar "pago
-- confirmado por Mercado Pago" contra "venta registrada en el sistema".
alter table public.mercadopago_qr_orders
  add column if not exists movimiento_id uuid references public.movimientos(id) on delete set null;
