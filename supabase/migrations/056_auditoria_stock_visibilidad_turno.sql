-- Auditoria de logica/seguridad 16/07: auditorias_stock/auditoria_stock_items
-- (migracion 049) nunca tuvieron el chequeo de visibilidad por turno que
-- movimientos tiene desde la migracion 036 -- cualquier encargado/vendedor
-- de una sucursal podia leer, via API directa, las auditorias de OTROS
-- turnos de HOY (no solo el propio). Cuando la migracion 054 hizo la
-- auditoria genuinamente "por turno", este hueco paso de cosmetico a real
-- (antes, con "una por dia", ya era la unica del dia igual).
--
-- Se reusa movimiento_visible_por_turno() tal cual -- mismo criterio que el
-- resto del sistema: dias anteriores a hoy, sin restriccion; hoy, solo el
-- turno propio.

drop policy if exists "staff_select_auditorias_stock" on public.auditorias_stock;
create policy "staff_select_auditorias_stock" on public.auditorias_stock
  for select to authenticated
  using (
    is_admin()
    or (
      (sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
       or sucursal_id = public.my_sucursal_id())
      and public.movimiento_visible_por_turno(sucursal_id, fecha, created_at)
    )
  );

drop policy if exists "staff_select_auditoria_stock_items" on public.auditoria_stock_items;
create policy "staff_select_auditoria_stock_items" on public.auditoria_stock_items
  for select to authenticated
  using (
    is_admin()
    or auditoria_id in (
      select a.id from public.auditorias_stock a
      where (a.sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
             or a.sucursal_id = public.my_sucursal_id())
        and public.movimiento_visible_por_turno(a.sucursal_id, a.fecha, a.created_at)
    )
  );
