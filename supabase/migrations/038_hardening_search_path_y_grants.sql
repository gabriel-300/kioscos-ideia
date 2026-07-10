-- Auditoria 06/07, menores:
-- 1) Las 3 RPCs financieras (crear_movimiento_con_items, abrir_caja, cerrar_caja)
--    son SECURITY DEFINER sin `search_path` fijo -- un search_path mutable en una
--    funcion SECURITY DEFINER es el vector clasico de "search_path hijacking"
--    (alguien con permiso de crear objetos en un esquema que quede antes en el
--    search_path de la sesion podria hacer que la funcion resuelva una tabla u
--    otra funcion homonima maliciosa en vez de la real, y ejecutarla con los
--    privilegios elevados del dueño de la funcion).
--
--    Se usa ALTER FUNCTION ... SET search_path (no CREATE OR REPLACE) --
--    cambia solo la configuracion de la funcion, no toca el cuerpo ni la firma,
--    cero riesgo de crear un overload duplicado (ver incidente documentado en
--    028_fix_cerrar_caja_overload_ambiguity.sql). Se fija en 'public' (no ''),
--    porque los cuerpos de estas 3 funciones usan nombres de tabla SIN
--    prefijo de esquema (ej. "from movimientos", no "from public.movimientos")
--    -- un search_path vacio las hubiera roto por completo.
--
-- 2) my_sucursal_id() e is_admin() se usan solo DENTRO de policies de RLS
--    "to authenticated" -- no hay ningun caso de uso que necesite que `anon`
--    (sin login) pueda invocarlas directo, pero por default Postgres les da
--    EXECUTE a PUBLIC (incluye anon) al crearlas. Se achica a solo
--    `authenticated`, que es lo unico que realmente las necesita.

alter function public.crear_movimiento_con_items(
  uuid, date, text, text, text, text, text, uuid, numeric, numeric, numeric, numeric, uuid, jsonb
) set search_path = 'public';

alter function public.abrir_caja(
  uuid, date, numeric, text, uuid
) set search_path = 'public';

alter function public.cerrar_caja(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, numeric
) set search_path = 'public';

-- my_sucursal_id() tenía, además del grant implícito a PUBLIC, un grant
-- EXPLÍCITO separado a `anon` (revocar de PUBLIC no alcanza para sacarlo).
revoke execute on function public.my_sucursal_id() from public;
revoke execute on function public.my_sucursal_id() from anon;
grant  execute on function public.my_sucursal_id() to authenticated;

revoke execute on function public.is_admin() from public;
grant  execute on function public.is_admin() to authenticated;
