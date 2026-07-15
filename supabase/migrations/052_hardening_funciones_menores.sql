-- Auditoria 15/07, hallazgos bajos/informativos 10, 12, 13: la migracion 038
-- endurecio search_path y grants en crear_movimiento_con_items, abrir_caja,
-- cerrar_caja, is_admin() y my_sucursal_id(), pero dejo afuera tres funciones
-- de menor uso con el mismo perfil de riesgo (SECURITY DEFINER / grant de mas
-- a anon). Explotabilidad baja en los tres casos (ninguna referencia sin
-- calificar a tabla/funcion, y las que exponen datos solo devuelven el JWT
-- de quien llama) -- esto es para que quede consistente con la convencion
-- que el propio proyecto ya se exige, no porque haya un hueco activo.
--
-- ALTER FUNCTION (no CREATE OR REPLACE) para no arriesgar duplicar un
-- overload -- mismo criterio que la 038.

alter function public.handle_new_user() set search_path = '';
alter function public.current_role()    set search_path = '';

-- current_role() nunca necesito que anon (sin login) la invoque -- mismo
-- motivo por el que 038 se lo saco a is_admin()/my_sucursal_id().
revoke execute on function public.current_role() from public;
revoke execute on function public.current_role() from anon;
grant  execute on function public.current_role() to authenticated;

-- movimiento_visible_por_turno() (migracion 036) quedo con el grant publico
-- por defecto -- auth.uid() da null para anon asi que el EXISTS nunca
-- matchea, pero toca datos de caja y no hay ningun caso de uso real donde
-- anon la necesite.
revoke execute on function public.movimiento_visible_por_turno(uuid, date, timestamptz) from public;
revoke execute on function public.movimiento_visible_por_turno(uuid, date, timestamptz) from anon;
grant  execute on function public.movimiento_visible_por_turno(uuid, date, timestamptz) to authenticated;
