-- Auditoria 06/07, critico #5: las policies "ALL" de encargado/vendedor en
-- aperturas_caja y cierres_caja permitian INSERT/UPDATE/DELETE directo por REST,
-- saltando por completo las RPCs abrir_caja/cerrar_caja (su candado de "caja ya
-- cerrada", el recalculo server-side de retiros_turno, e incluso permitia borrar
-- un cierre con faltante antes de que un admin lo viera).
--
-- Fix: encargado/vendedor pasan a tener solo SELECT en estas 2 tablas -- mismo
-- patron que ya usa "movimientos" (que esta bien hecho). Los admins conservan
-- ALL, y las RPCs siguen funcionando igual porque corren via service_role
-- (createAdminClient()), que bypasea RLS por completo.
--
-- NOTA: ya aplicada directo contra la base el 2026-07-06 via MCP.

-- aperturas_caja
drop policy if exists encargado_own_aperturas on public.aperturas_caja;
create policy encargado_select_aperturas on public.aperturas_caja
  for select to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'encargado')
    and (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );

drop policy if exists vendedor_own_aperturas on public.aperturas_caja;
create policy vendedor_select_aperturas on public.aperturas_caja
  for select to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'vendedor')
    and (sucursal_id = public.my_sucursal_id())
  );

-- cierres_caja
drop policy if exists vendedor_own_cierres on public.cierres_caja;
create policy vendedor_select_cierres on public.cierres_caja
  for select to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'vendedor')
    and (sucursal_id = public.my_sucursal_id())
  );

drop policy if exists cierres_caja_access on public.cierres_caja;
create policy admin_all_cierres on public.cierres_caja
  for all to authenticated
  using (((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin'))
  with check (((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin'));

create policy encargado_select_cierres on public.cierres_caja
  for select to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'encargado')
    and (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
