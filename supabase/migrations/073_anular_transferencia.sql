-- Anular una transferencia de stock cargada por error -- solo admin (a
-- diferencia de anular una venta, que puede hacer cualquiera del staff de esa
-- sucursal mientras la caja siga abierta). No la borra, la marca (quién,
-- cuándo, motivo obligatorio), mismo criterio que anular_venta (migración
-- 063): el o los movimientos asociados (salida siempre, entrada también si
-- ya fue confirmada) se marcan con el `anulado_en` que `stock_sucursal` ya
-- sabe ignorar -- no hace falta tocar la view.

alter table public.transferencias_stock
  add column if not exists anulada_en       timestamptz,
  add column if not exists anulada_por      uuid references auth.users(id),
  add column if not exists motivo_anulacion text;
