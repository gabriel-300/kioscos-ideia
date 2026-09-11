-- Bug real encontrado probando con el usuario de Enzo (concesionario,
-- Villasarita): la pagina de la sucursal lee aperturas_caja/cierres_caja
-- con el cliente de sesion (sujeto a RLS), no con el admin client -- a
-- diferencia de casi todo lo demas de esta sesion, que va por
-- createAdminClient() y por eso nunca necesito tocar RLS. Las policies de
-- 030_restrict_aperturas_cierres_write_to_admin.sql comparan el rol contra
-- el string exacto 'encargado', asi que un concesionario no matcheaba
-- ninguna policy y RLS le devolvia 0 filas en silencio -- la pagina
-- interpretaba "sin apertura" y mostraba "Abri la caja" aunque estuviera
-- abierta de verdad.
--
-- Mismo criterio de scoping que ya usa encargado (sucursales.encargado_user_id).

create policy concesionario_select_aperturas on public.aperturas_caja
  for select to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'concesionario')
    and (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );

create policy concesionario_select_cierres on public.cierres_caja
  for select to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'concesionario')
    and (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
