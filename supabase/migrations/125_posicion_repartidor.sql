-- 125: ubicación en vivo del repartidor (solo la ÚLTIMA posición, mientras el pedido está en reparto).
--
-- Una fila por pedido en reparto: pedido_id, quién reparte, lat/lng, precisión del GPS y cuándo se actualizó.
-- NO es un historial de recorridos: cada envío del repartidor pisa la fila (upsert). La fila se borra sola
-- apenas el pedido deja de estar "en_reparto" (entregado, cancelado, lo que sea) con el trigger de abajo, y
-- aunque algo fallara, el servidor nunca la lee ni la muestra si el pedido no está en reparto.
--
-- Acceso: SOLO el servidor de la app (cliente admin / service_role). RLS activada y sin ninguna policy, y sin
-- permisos para anon ni authenticated: desde el navegador no se puede leer ni escribir directo. Las reglas
-- (quién puede escribir, quién puede leer) están en las Server Actions (src/lib/pedidos/posicion-actions.ts).
--
-- (Esta migración usa el número 125 a propósito: la 124 la reserva otro trabajo en paralelo.)

create table if not exists public.repartidor_posiciones (
  pedido_id      uuid primary key references public.pedidos(id) on delete cascade,
  repartidor_id  uuid not null references auth.users(id) on delete cascade,
  latitud        double precision not null check (latitud between -90 and 90),
  longitud       double precision not null check (longitud between -180 and 180),
  precision_m    double precision check (precision_m is null or precision_m >= 0),
  actualizado_en timestamptz not null default now()
);

create index if not exists repartidor_posiciones_repartidor_idx on public.repartidor_posiciones (repartidor_id);

alter table public.repartidor_posiciones enable row level security;
revoke all on public.repartidor_posiciones from anon, authenticated;

-- Privacidad: cuando el pedido sale de "en_reparto", se borra la posición.
create or replace function public.borrar_posicion_repartidor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado = 'en_reparto' and new.estado is distinct from 'en_reparto' then
    delete from public.repartidor_posiciones where pedido_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.borrar_posicion_repartidor() from public, anon, authenticated;

drop trigger if exists trg_borrar_posicion_repartidor on public.pedidos;
create trigger trg_borrar_posicion_repartidor
  after update of estado on public.pedidos
  for each row execute function public.borrar_posicion_repartidor();

-- ── Verificación (correr después) ───────────────────────────────────────────
-- select relrowsecurity from pg_class where oid = 'public.repartidor_posiciones'::regclass;            -- true
-- select count(*) from pg_policies where tablename = 'repartidor_posiciones';                          -- 0
-- select has_table_privilege('authenticated', 'public.repartidor_posiciones', 'select');                -- false
