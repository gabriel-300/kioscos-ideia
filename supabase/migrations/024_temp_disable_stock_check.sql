-- TEMPORAL (2026-07-03): desactiva el bloqueo por stock insuficiente dentro de
-- crear_movimiento_con_items mientras se termina de cargar el stock real
-- (entregas) del catálogo y se hacen pruebas de venta.
--
-- *** REACTIVAR la semana del 2026-07-07 *** (a pedido del usuario, ver
-- memoria del proyecto "golive-batch12-fixes" / recordatorio stock check).
-- Para reactivar: volver a aplicar la definición de crear_movimiento_con_items
-- de la migración 023_fix_stock_ajuste_y_view.sql (la que sí tiene el
-- "raise exception" cuando v_stock < 0).
--
-- Aplicada en producción vía MCP el 2026-07-03.

create or replace function crear_movimiento_con_items(
  p_sucursal_id        uuid,
  p_fecha              date,
  p_tipo               text,
  p_notas              text    default null,
  p_proveedor          text    default null,
  p_nro_remito         text    default null,
  p_canal              text    default 'consumidor_final',
  p_personal_id        uuid    default null,
  p_pago_efectivo      numeric default null,
  p_pago_billetera     numeric default null,
  p_pago_tarjeta       numeric default null,
  p_pago_transferencia numeric default null,
  p_created_by         uuid    default null,
  p_items              jsonb   default '[]'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_movimiento_id uuid;
  v_item          jsonb;
  v_product_id    uuid;
  v_stock         numeric;
begin
  insert into movimientos (
    sucursal_id, fecha, tipo, notas, proveedor, nro_remito,
    canal, personal_id,
    pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia,
    created_by
  ) values (
    p_sucursal_id, p_fecha, p_tipo, p_notas, p_proveedor, p_nro_remito,
    p_canal, p_personal_id,
    p_pago_efectivo, p_pago_billetera, p_pago_tarjeta, p_pago_transferencia,
    p_created_by
  )
  returning id into v_movimiento_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into movimiento_items (movimiento_id, product_id, cantidad, precio_unitario, subtotal, promo_id)
    values (
      v_movimiento_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'cantidad')::numeric,
      nullif(v_item->>'precio_unitario', 'null')::numeric,
      nullif(v_item->>'subtotal',        'null')::numeric,
      nullif(v_item->>'promo_id',        'null')::uuid
    );
  end loop;

  for v_product_id in
    select distinct (item->>'product_id')::uuid from jsonb_array_elements(p_items) item
  loop
    perform pg_advisory_xact_lock(hashtext(p_sucursal_id::text), hashtext(v_product_id::text));

    select coalesce(sum(case
          when m.tipo = 'entrega' then mi.cantidad
          when m.tipo = 'ajuste' then mi.cantidad
          when m.tipo in ('devolucion','venta') then -mi.cantidad
          else 0
        end), 0)
    into v_stock
    from movimiento_items mi
    join movimientos m on m.id = mi.movimiento_id
    where m.sucursal_id = p_sucursal_id and mi.product_id = v_product_id;

    -- Chequeo de stock insuficiente DESACTIVADO temporalmente (ver arriba)
    null;
  end loop;

  return v_movimiento_id;
end;
$$;
