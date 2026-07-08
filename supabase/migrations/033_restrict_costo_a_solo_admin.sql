-- El costo/margen de los productos es informacion sensible del negocio -- a
-- pedido del usuario, deja de ser visible/editable por encargado, solo admin.
-- (precio_dist / precio de venta al kiosco sigue siendo visible para encargado,
-- lo necesita para atender).
--
-- NOTA: ya aplicada directo contra la base el 2026-07-07 via MCP.

drop policy if exists staff_read_ph on public.product_price_history;
create policy admin_read_ph on public.product_price_history
  for select to authenticated
  using ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'));
