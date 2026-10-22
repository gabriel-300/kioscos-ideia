-- 120: "Lo más pedido" de la tienda online.
--
-- Devuelve lo que más se vendió en una sucursal en los últimos N días (promos y productos sueltos,
-- caja y pedidos online juntos), contando en cuántas ventas apareció. La tienda lo usa para mostrar
-- primero lo que más sale. Las ventas anuladas no cuentan.

create or replace function public.top_vendidos_sucursal(p_sucursal uuid, p_dias integer default 60, p_limite integer default 40)
returns table (clave uuid, veces bigint)
language sql
stable
as $$
  select coalesce(mi.promo_id, mi.product_id) as clave, count(distinct m.id) as veces
  from public.movimiento_items mi
  join public.movimientos m on m.id = mi.movimiento_id
  where m.sucursal_id = p_sucursal
    and m.tipo = 'venta'
    and m.anulado_en is null
    and m.fecha >= current_date - p_dias
    and coalesce(mi.promo_id, mi.product_id) is not null
  group by 1
  order by veces desc
  limit p_limite;
$$;

-- Solo la usa el servidor de la tienda (clave de servicio): no se expone al navegador.
revoke all on function public.top_vendidos_sucursal(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.top_vendidos_sucursal(uuid, integer, integer) to service_role;
