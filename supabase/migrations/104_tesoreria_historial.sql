-- 104: Tesorería, historial de todo lo que se hace (quién, cuándo, qué cambió y por qué).
--
-- Contexto: en Tesorería hay números que mueven la plata (egresos, el efectivo inicial, qué ingresos del kiosco "no
-- corresponden") y permisos que habilitan a cargarlos. Hasta ahora algunas cosas guardaban solo quién tocó por última vez
-- (el efectivo inicial pisaba el valor anterior sin dejar rastro). Este historial es un registro APARTE, de solo agregar:
-- cada acción (cargar, pagar, anular un egreso, descartar o restaurar un ingreso del kiosco, cambiar el efectivo inicial,
-- cambiar quién es administrativo o socio) deja una fila con el usuario, el momento, el detalle (valores antes y después) y
-- el motivo si lo hubo. Nunca se edita ni se borra: un trigger lo impide para cualquier rol, incluido el servidor.
--
-- Escribe solo el servidor (service_role); lo lee un admin. No toca ninguna tabla existente.
--
-- Orden de despliegue: la pantalla de Tesorería muestra un aviso hasta que se aplique; el resto del sistema no depende de ella.
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 103.

create table if not exists public.tesoreria_historial (
  id          uuid primary key default gen_random_uuid(),
  creado_en   timestamptz not null default now(),
  usuario_id  uuid references auth.users(id),
  accion      text not null check (accion in (
                'egreso_creado', 'egreso_pagado', 'egreso_anulado',
                'entrega_descartada', 'entrega_restaurada',
                'efectivo_inicial_cambiado', 'permiso_cambiado')),
  entidad_id  uuid,                                    -- egreso, entrega o persona afectada (según la acción)
  detalle     jsonb not null default '{}'::jsonb,      -- valores antes y después, importes, descripción
  motivo      text
);

create index if not exists tesoreria_historial_creado_idx on public.tesoreria_historial (creado_en desc);
create index if not exists tesoreria_historial_accion_idx on public.tesoreria_historial (accion, creado_en desc);

comment on table  public.tesoreria_historial is 'Registro de solo agregar de lo que se hace en Tesorería. Un trigger impide editarlo o borrarlo. Escribe solo el servidor.';
comment on column public.tesoreria_historial.entidad_id is 'Egreso, entrega (movimiento) o persona afectada, según la acción.';
comment on column public.tesoreria_historial.detalle is 'Valores antes y después, importes y descripción: lo necesario para entender el cambio sin buscar la fila original.';

-- ── Solo agregar: ni editar ni borrar, para ningún rol ─────────────────────
create or replace function public.tesoreria_historial_inmutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'El historial de Tesorería no se puede modificar ni borrar';
end;
$$;

drop trigger if exists tesoreria_historial_no_editar on public.tesoreria_historial;
create trigger tesoreria_historial_no_editar
  before update or delete on public.tesoreria_historial
  for each row execute function public.tesoreria_historial_inmutable();

-- Vaciarlo en bloque tampoco: truncate no dispara el trigger de fila.
drop trigger if exists tesoreria_historial_no_vaciar on public.tesoreria_historial;
create trigger tesoreria_historial_no_vaciar
  before truncate on public.tesoreria_historial
  for each statement execute function public.tesoreria_historial_inmutable();

-- ── Permisos y RLS ─────────────────────────────────────────────────────────
alter table public.tesoreria_historial enable row level security;

revoke all on public.tesoreria_historial from anon, authenticated;
grant select on public.tesoreria_historial to authenticated;
-- El servidor (service_role) solo agrega y lee: se le saca el permiso de editar y borrar además del trigger.
revoke update, delete, truncate on public.tesoreria_historial from service_role;

drop policy if exists "tesoreria_historial_select_admin" on public.tesoreria_historial;
create policy "tesoreria_historial_select_admin" on public.tesoreria_historial for select to authenticated
  using ((select is_admin()));

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select count(*) from public.tesoreria_historial;                                          -- 0
-- select tgname from pg_trigger where tgrelid = 'public.tesoreria_historial'::regclass and not tgisinternal order by 1;
--   -- tesoreria_historial_no_editar y tesoreria_historial_no_vaciar
-- select has_table_privilege('authenticated', 'public.tesoreria_historial', 'insert'),
--        has_table_privilege('anon', 'public.tesoreria_historial', 'select'),
--        has_table_privilege('service_role', 'public.tesoreria_historial', 'update');       -- false, false, false
--
-- Reversión (solo si hiciera falta; borra el historial):
--   drop table if exists public.tesoreria_historial;
--   drop function if exists public.tesoreria_historial_inmutable();
