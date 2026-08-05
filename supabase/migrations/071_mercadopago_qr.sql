-- ============================================================
-- COBRO CON QR DINÁMICO DE MERCADO PAGO
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Damián ya tiene Mercado Pago armado como cobrador: un "Local" con varias
-- "Cajas" (una por sucursal), cada una con un sticker de QR ESTÁTICO ya
-- impreso -- el cliente tiene que tipear el monto a mano al escanear.
--
-- Mercado Pago permite un QR DINÁMICO: sin cambiar el sticker, el sistema le
-- dice a la API "la próxima vez que escaneen la Caja de tal sucursal, es por
-- $X" justo antes de que pague el cliente, y avisa por webhook cuando se
-- acredita. Mismo criterio que 058_pedidoya_integracion.sql: infraestructura
-- completa ahora, funciona apenas se carguen las credenciales reales como
-- secrets de Cloudflare (MERCADOPAGO_ACCESS_TOKEN / MERCADOPAGO_USER_ID /
-- MERCADOPAGO_WEBHOOK_SECRET).
-- ============================================================

alter table public.sucursales
  add column if not exists mercadopago_pos_id text;

create table if not exists public.mercadopago_qr_orders (
  id                  uuid primary key default gen_random_uuid(),
  sucursal_id         uuid not null references public.sucursales(id) on delete cascade,
  external_reference  text not null unique,
  monto               numeric(12,2) not null,
  estado              text not null default 'pendiente' check (estado in ('pendiente','pagado','cancelado','expirado')),
  mp_payment_id       text,
  raw_webhook_payload jsonb,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  paid_at             timestamptz
);

create index if not exists mercadopago_qr_orders_sucursal_idx on public.mercadopago_qr_orders (sucursal_id, estado);
create index if not exists mercadopago_qr_orders_external_ref_idx on public.mercadopago_qr_orders (external_reference);

alter table public.mercadopago_qr_orders enable row level security;

-- Mismo criterio que transferencias_stock/prestamos_termo: staff ve las
-- órdenes de su propia sucursal, admin ve todo. Los insert/update siempre
-- van vía server action con el cliente admin (service_role) -- nunca se le
-- da policy de insert/update a staff, la autorización se valida en código.
create policy "admin_all_mercadopago_qr_orders" on public.mercadopago_qr_orders for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "staff_select_mercadopago_qr_orders" on public.mercadopago_qr_orders for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );
