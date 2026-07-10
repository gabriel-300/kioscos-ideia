-- Backfill de cierres_caja.total_fiado (agregada en 042) para los cierres
-- anteriores a esa migracion, que quedaron todos en 0 por el default. Se
-- recalcula reconstruyendo la ventana de turno de cada cierre (la apertura
-- mas reciente de esa sucursal con created_at <= cierre.created_at, hasta
-- el propio created_at del cierre) -- misma logica que ya usa cierre-actions.ts
-- al cerrar en vivo.
--
-- Verificado antes de aplicar: el turno mas reciente da $14.500, el mismo
-- numero que ya se habia visto en el modal de cierre al momento de cerrarlo.

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
set total_fiado = coalesce((
  select sum(mi.subtotal)
  from public.movimientos m
  join public.movimiento_items mi on mi.movimiento_id = m.id
  where m.sucursal_id = ta.sucursal_id
    and m.tipo = 'venta'
    and m.canal = 'cuenta_corriente'
    and m.created_at >= ta.apertura_created_at
    and m.created_at <= ta.created_at
), 0)
from turno_apertura ta
where ta.cierre_id = c.id
  and ta.apertura_created_at is not null;
