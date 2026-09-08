-- ============================================================
-- WHATSAPP CLOUD API — webhook entrante (Fase 3, parte "solo escucha")
-- Correr en Supabase → SQL Editor → New query → Run
--
-- A diferencia del webhook de PedidoYa (058), el formato del payload de
-- WhatsApp Cloud API SÍ está documentado y es estable (spec pública de
-- Meta), así que este SÍ escribe directo en contactos_crm -- no hace falta
-- una etapa de staging manual antes de confiar en los datos. Igual se
-- guarda cada evento crudo en whatsapp_webhook_events, para debug y para
-- deduplicar reintentos de entrega de Meta (misma idea que el registro de
-- eventos de PedidoYa, adaptada).
--
-- Deliberadamente NO manda nada de vuelta -- solo registra el contacto.
-- Auto-respuesta / matching de palabras clave queda fuera de esta fase
-- (ver conversación con Gabriel, set. 2026: eso tiene costo por mensaje y
-- riesgo real de que Meta banee el número si se hace mal).
-- ============================================================

alter table public.sucursales
  add column if not exists whatsapp_phone_number_id text;

create unique index if not exists sucursales_whatsapp_phone_number_id_idx
  on public.sucursales (whatsapp_phone_number_id) where whatsapp_phone_number_id is not null;

create table if not exists public.whatsapp_webhook_events (
  id               uuid primary key default gen_random_uuid(),
  received_at      timestamptz not null default now(),
  raw_payload      jsonb not null,
  wa_message_id    text,
  wa_from          text,
  phone_number_id  text,
  sucursal_id      uuid references public.sucursales(id) on delete set null,
  contacto_id      uuid references public.contactos_crm(id) on delete set null,
  status           text not null default 'processed' check (status in ('processed', 'error', 'sin_sucursal')),
  error_message    text
);

-- Índice único parcial: además de servir para consultas, es la defensa real
-- contra procesar dos veces el mismo mensaje si Meta reintenta la entrega
-- (más confiable que un SELECT-antes-de-INSERT desde la app, que deja una
-- ventana de carrera).
create unique index if not exists whatsapp_webhook_events_wa_message_id_idx
  on public.whatsapp_webhook_events (wa_message_id) where wa_message_id is not null;

create index if not exists whatsapp_webhook_events_received_at_idx on public.whatsapp_webhook_events (received_at desc);

alter table public.whatsapp_webhook_events enable row level security;

do $$ begin
  create policy "Admins leen eventos de WhatsApp"
    on public.whatsapp_webhook_events for select to authenticated
    using (is_admin());
exception when duplicate_object then null; end $$;

grant select on public.whatsapp_webhook_events to authenticated;
