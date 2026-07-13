-- Backfill de cierres_caja.total_plataforma (agregada en 047) para los
-- cierres anteriores a esa migracion, que quedaron todos en 0 por el
-- default. Misma logica de reconstruccion de ventana de turno que ya usa
-- 043_backfill_total_fiado_historico.sql.
--
-- Verificado antes de aplicar: hay $13.865 reales en movimientos con canal
-- 'pedido_ya_plataforma' (4 registros) que quedarian en 0 sin este backfill.

with turno_apertura as (
  select c.id as cierre_id, c.sucursal_id, c.created_at,
         (
           select a.created_at
           from public.aperturas_caja a
           where a.sucursal_id = c.sucursal_id
             and a.created_at <= c.created_at
           order by a.created_at desc
           limit 1
         ) as apertura_created_at
  from public.cierres_caja c
)
update public.cierres_caja c
set total_plataforma = coalesce((
  select sum(mi.subtotal)
  from public.movimientos m
  join public.movimiento_items mi on mi.movimiento_id = m.id
  where m.sucursal_id = ta.sucursal_id
    and m.tipo = 'venta'
    and m.canal = 'pedido_ya_plataforma'
    and m.created_at >= ta.apertura_created_at
    and m.created_at <= ta.created_at
), 0)
from turno_apertura ta
where ta.cierre_id = c.id
  and ta.apertura_created_at is not null;
