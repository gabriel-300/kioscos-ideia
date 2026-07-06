-- Auditoria 06/07, critico #4: un vendedor/encargado podia auto-reasignarse a otra
-- sucursal (o pisar su propio rol/limite de credito) con un PATCH directo a su
-- propia fila de profiles, ya que profiles_update permitia auth.uid() = id sin
-- restriccion de columnas. Casi todo el RLS de vendedor (movimientos, caja,
-- cta_corriente_pagos) depende de sucursal_id via my_sucursal_id().
--
-- Fix: revocar el UPDATE de TODA la tabla para "authenticated" y volver a
-- otorgarlo solo en las columnas no sensibles. (Un primer intento de revocar
-- columna por columna sin tocar el grant de tabla no tuvo efecto: en Postgres,
-- un GRANT UPDATE a nivel de tabla domina sobre cualquier revoke a nivel de
-- columna -- hay que revocar la tabla entera y re-otorgar la lista segura).
--
-- Los admins siguen pudiendo editar sucursal_id/role/credito_limite porque el
-- panel usa createAdminClient() (service_role), ajeno a estos grants. El resto
-- de las columnas de profiles (full_name, phone, etc. -- algunas son de la otra
-- app que comparte este proyecto) sigue editable por el propio usuario, sin
-- cambios de comportamiento.
--
-- NOTA: ya aplicada directo contra la base el 2026-07-06 via MCP.

revoke update on public.profiles from authenticated;

grant update (
  id, full_name, phone, document_type, document_number,
  canal, zona_id, b2b_status, created_at, updated_at
) on public.profiles to authenticated;
-- Deliberadamente sin sucursal_id / role / credito_limite.
