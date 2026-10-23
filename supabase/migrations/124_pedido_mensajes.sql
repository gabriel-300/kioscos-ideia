-- 124: chat interno de cada pedido online (cliente <-> local y, en reparto, cliente <-> repartidor).
--
-- Un solo hilo por pedido; cada mensaje lleva la etiqueta de quien lo escribió (cliente | local | repartidor).
-- Todo queda guardado: al entregarse o cancelarse el pedido el hilo pasa a solo lectura, nunca se borra
-- (solo se borra si se borra el pedido).
--
-- Acceso: ninguno desde el navegador. RLS activada y SIN policies (deny-all para anon/authenticated); todo
-- pasa por Server Actions con el cliente admin (service_role), que validan en el servidor quién es y a qué
-- pedido puede entrar (src/lib/pedidos/chat.ts). Mismo criterio que pedido_rate_limits.

create table if not exists public.pedido_mensajes (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null references public.pedidos(id) on delete cascade,
  autor      text not null check (autor in ('cliente', 'local', 'repartidor')),
  user_id    uuid references auth.users(id) on delete set null,  -- quien escribió, si es personal/repartidor (null = cliente)
  texto      text not null check (char_length(texto) between 1 and 500),
  leido_por  text[] not null default '{}',                         -- lados que ya lo leyeron: 'cliente' | 'local' | 'repartidor'
  created_at timestamptz not null default now()
);

create index if not exists pedido_mensajes_pedido_idx on public.pedido_mensajes (pedido_id, created_at);

alter table public.pedido_mensajes enable row level security;

-- Marca como leídos por `p_lector` los mensajes del pedido que escribió otro lado. Una sola llamada
-- (en vez de una por mensaje). Solo la puede ejecutar service_role.
create or replace function public.chat_marcar_leidos(p_pedido uuid, p_lector text)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.pedido_mensajes
     set leido_por = array_append(leido_por, p_lector)
   where pedido_id = p_pedido
     and autor <> p_lector
     and not (p_lector = any(leido_por));
$$;

revoke all on function public.chat_marcar_leidos(uuid, text) from public, anon, authenticated;
grant execute on function public.chat_marcar_leidos(uuid, text) to service_role;
