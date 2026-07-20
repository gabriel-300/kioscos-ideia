-- ============================================================
-- INTEGRACIÓN PEDIDOSYA — infraestructura del webhook
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Todavía no tenemos token/documentación real del Vendor Portal de
-- PedidosYa (gestión comercial en curso, ver memoria del proyecto). Esta
-- migración prepara el terreno sin inventar el formato del payload:
--   - pedidoya_store_id en sucursales, para mapear tienda PedidosYa → kiosco
--     una vez que tengamos los IDs reales.
--   - pedidoya_webhook_events: guarda cada payload crudo que llegue al
--     webhook, para poder inspeccionarlo cuando PedidosYa mande pedidos de
--     prueba y recién ahí terminar el mapeo a movimientos.
-- ============================================================

alter table public.sucursales
  add column if not exists pedidoya_store_id text;

create unique index if not exists sucursales_pedidoya_store_id_idx
  on public.sucursales (pedidoya_store_id) where pedidoya_store_id is not null;

create table if not exists public.pedidoya_webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  received_at        timestamptz not null default now(),
  raw_payload        jsonb not null,
  external_order_id  text,
  external_store_id  text,
  sucursal_id        uuid references public.sucursales(id) on delete set null,
  movimiento_id      uuid references public.movimientos(id) on delete set null,
  status             text not null default 'received' check (status in ('received','processed','error','ignored')),
  error_message      text,
  processed_at       timestamptz
);

create index if not exists pedidoya_webhook_events_received_at_idx on public.pedidoya_webhook_events (received_at desc);
create index if not exists pedidoya_webhook_events_status_idx      on public.pedidoya_webhook_events (status);

alter table public.pedidoya_webhook_events enable row level security;

-- Solo lectura para admin -- el insert lo hace el webhook con el cliente
-- admin (service_role), que no pasa por RLS.
do $$ begin
  create policy "Admins leen eventos de PedidoYa"
    on public.pedidoya_webhook_events for select to authenticated
    using (is_admin());
exception when duplicate_object then null; end $$;

grant select on public.pedidoya_webhook_events to authenticated;
