-- Fix: la regla "cada uno ve su turno" (036) oculta movimientos de HOY que
-- caen fuera de la ventana [apertura, proximo cierre] de quien consulta --
-- pero esa ventana se calcula solo por horario, sin importar quien creo el
-- movimiento. Caso real 2026-07-10: un vendedor cargo una entrega de stock
-- ANTES de abrir su turno del dia; su propia pantalla de venta calculaba el
-- stock sin esa entrada (quedaba fuera de su ventana) y mostraba "Agotado"
-- un producto con stock fisico real.
--
-- La intencion original de 036 era que un vendedor/encargado no vea los
-- movimientos de OTRO turno del mismo dia -- nunca fue ocultarle sus PROPIOS
-- movimientos a si mismo. Se agrega "o yo lo cree" como condicion adicional.

drop policy if exists "encargado_select_movimientos" on public.movimientos;
create policy "encargado_select_movimientos" on public.movimientos for select to authenticated
  using (
    sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    and (created_by = auth.uid() or public.movimiento_visible_por_turno(sucursal_id, fecha, created_at))
  );

drop policy if exists "vendedor_select_movimientos" on public.movimientos;
create policy "vendedor_select_movimientos" on public.movimientos for select to authenticated
  using (
    sucursal_id = my_sucursal_id()
    and (created_by = auth.uid() or public.movimiento_visible_por_turno(sucursal_id, fecha, created_at))
  );

drop policy if exists "encargado_select_movimiento_items" on public.movimiento_items;
create policy "encargado_select_movimiento_items" on public.movimiento_items for select to authenticated
  using (movimiento_id in (
    select m.id from public.movimientos m where m.sucursal_id in (
      select id from public.sucursales where encargado_user_id = auth.uid()
    )
    and (m.created_by = auth.uid() or public.movimiento_visible_por_turno(m.sucursal_id, m.fecha, m.created_at))
  ));

drop policy if exists "vendedor_select_movimiento_items" on public.movimiento_items;
create policy "vendedor_select_movimiento_items" on public.movimiento_items for select to authenticated
  using (movimiento_id in (
    select m.id from public.movimientos m where m.sucursal_id = my_sucursal_id()
    and (m.created_by = auth.uid() or public.movimiento_visible_por_turno(m.sucursal_id, m.fecha, m.created_at))
  ));
