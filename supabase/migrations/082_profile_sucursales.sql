-- ============================================================
-- VENDEDOR EN MÁS DE UNA SUCURSAL
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Hasta ahora profiles.sucursal_id era la única sucursal de un vendedor.
-- Se agrega profile_sucursales (varios-a-varios) como el conjunto de
-- sucursales donde el vendedor ESTÁ HABILITADO a trabajar.
--
-- profiles.sucursal_id NO se elimina ni cambia de tipo -- sigue siendo un
-- único valor, misma función my_sucursal_id(), mismas ~30 policies que ya
-- dependen de ella (movimientos, aperturas_caja, cierres_caja, etc.) --
-- pero pasa a significar "la sucursal en la que este vendedor tiene el
-- turno activo ahora", sincronizada solo al abrir caja (ver
-- apertura-actions.ts), en vez de "su única sucursal asignada". Así se
-- evita reescribir esas ~30 policies -- siguen funcionando exactamente
-- igual, apuntando a la sucursal activa.
--
-- Encargado no se toca: sigue siendo 1 sucursal exclusiva vía
-- sucursales.encargado_user_id.
-- ============================================================

create table public.profile_sucursales (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (profile_id, sucursal_id)
);

create index profile_sucursales_sucursal_id_idx on public.profile_sucursales(sucursal_id);

alter table public.profile_sucursales enable row level security;

create policy "admin_all_profile_sucursales" on public.profile_sucursales
  for all to authenticated using (is_admin()) with check (is_admin());

-- El propio vendedor puede leer sus asignaciones (para el picker de
-- /admin/sucursales y el redirect post-login) -- no las de compañeros, y
-- no puede escribir (solo admin, vía createAdminClient()).
create policy "own_select_profile_sucursales" on public.profile_sucursales
  for select to authenticated using (profile_id = auth.uid());

-- Backfill: todo el que ya tiene profiles.sucursal_id cargado queda con
-- esa fila acá -- cero cambio de comportamiento para el caso de hoy (una
-- sola sucursal por vendedor).
insert into public.profile_sucursales (profile_id, sucursal_id)
select id, sucursal_id from public.profiles
where sucursal_id is not null
on conflict (profile_id, sucursal_id) do nothing;

-- Sin esto, un vendedor con 2+ sucursales asignadas se lleva un 404 al
-- entrar a la que NO es su sucursal activa hoy -- la única policy de
-- SELECT sobre `sucursales` para vendedor hasta ahora era
-- "id = my_sucursal_id()" (022_fix_sucursales_own_row_select.sql).
create policy "vendedor_view_assigned_sucursales" on public.sucursales for select to authenticated
  using (exists (
    select 1 from public.profile_sucursales ps
    where ps.sucursal_id = sucursales.id and ps.profile_id = auth.uid()
  ));
