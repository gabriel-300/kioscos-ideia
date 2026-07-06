-- Corrige regresion de 027_fondo_siguiente_cierre.sql: al agregar p_fondo_siguiente
-- con "create or replace function" cambiando la firma, Postgres creo una funcion
-- NUEVA en vez de reemplazar la existente. Esto dejaba dos overloads de cerrar_caja:
-- 1) PostgREST no podia elegir cual invocar -> todo cierre de caja fallaba en produccion
--    ("Could not choose the best candidate function").
-- 2) La funcion nueva nacio con permisos default de Postgres (EXECUTE a PUBLIC),
--    reabriendo el hueco de seguridad de 025_security_lockdown_rpc_and_stock_view.sql.
--
-- NOTA: ya aplicada directo contra la base el 2026-07-06 via MCP
-- (apply_migration "fix_cerrar_caja_overload_ambiguity") -- se agrega ahora
-- retroactivamente como archivo versionado.

drop function if exists public.cerrar_caja(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid
);

revoke execute on function public.cerrar_caja(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, numeric
) from public, anon, authenticated;
