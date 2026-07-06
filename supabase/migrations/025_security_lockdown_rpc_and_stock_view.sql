-- Cierra el acceso sin autenticacion a las RPCs financieras/de stock y a la vista de
-- stock. Hallazgo de la auditoria de seguridad del 2026-07-05: crear_movimiento_con_items,
-- abrir_caja y cerrar_caja (todas SECURITY DEFINER) y la vista stock_sucursal (tambien
-- SECURITY DEFINER, bypasea RLS) tenian permisos otorgados a anon/authenticated a nivel
-- de Postgres -- permitian invocarlas directo via REST API con solo la anon key publica,
-- sin sesion, saltandose todos los checks de rol/sucursal que solo viven en las
-- Server Actions de Next.js.
--
-- NOTA: esta migracion ya se habia aplicado directo contra la base el 2026-07-05 via
-- MCP (apply_migration "security_lockdown_rpc_and_stock_view") pero no se habia
-- guardado como archivo versionado en el repo -- se agrega ahora retroactivamente.

revoke execute on function crear_movimiento_con_items from public, anon, authenticated;
revoke execute on function abrir_caja               from public, anon, authenticated;
revoke execute on function cerrar_caja              from public, anon, authenticated;
-- Estas RPCs solo las invoca el server (createAdminClient(), rol service_role) -- no
-- hace falta ningun otro rol de Postgres para ejecutarlas.

revoke insert, update, delete, truncate, references, trigger on stock_sucursal from anon, authenticated;
revoke select on stock_sucursal from anon;
-- authenticated conserva SELECT (lo usa la app via el cliente normal en server components),
-- pero ahora queda protegido por las mismas RLS de movimientos/movimiento_items/products
-- gracias a security_invoker en vez de bypasearlas como vista SECURITY DEFINER.
alter view stock_sucursal set (security_invoker = on);
