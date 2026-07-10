-- Nuevo tipo de movimiento "merma" para registrar producto perdido (se puso
-- duro, se venció, se rompió, etc.). Hasta ahora no había ninguna forma de
-- restar del stock lo que se pierde sin venderse -- quedaba como stock
-- fantasma para siempre (nunca se registraba como salida), desincronizando
-- de a poco el conteo real contra lo que el sistema cree que hay.
--
-- NOTA: ya aplicada directo contra la base el 2026-07-10 via MCP.

alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo = any (array['entrega', 'devolucion', 'ajuste', 'venta', 'merma']));

-- stock_sucursal: merma resta stock igual que devolución/venta.
create or replace view public.stock_sucursal
with (security_invoker = on)
as
 select m.sucursal_id,
    mi.product_id,
    p.name as product_name,
    p.sku,
    sum(
        case
            when m.tipo = 'entrega' then mi.cantidad
            when m.tipo = 'ajuste' and mi.cantidad > 0 then mi.cantidad
            else 0
        end) as entradas,
    sum(
        case
            when m.tipo = any (array['devolucion', 'venta', 'merma']) then mi.cantidad
            when m.tipo = 'ajuste' and mi.cantidad < 0 then abs(mi.cantidad)
            else 0
        end) as salidas,
    sum(
        case
            when m.tipo = 'entrega' then mi.cantidad
            when m.tipo = 'ajuste' then mi.cantidad
            when m.tipo = any (array['devolucion', 'venta', 'merma']) then -mi.cantidad
            else 0
        end) as stock_actual
   from movimiento_items mi
     join movimientos m on m.id = mi.movimiento_id
     join products p on p.id = mi.product_id
  group by m.sucursal_id, mi.product_id, p.name, p.sku;

-- crear_movimiento_con_items: misma firma (sin riesgo de overload duplicado),
-- solo se actualiza la fórmula de stock (hoy inerte, el chequeo sigue
-- desactivado a propósito) para que merma también reste cuando se reactive.
create or replace function public.crear_movimiento_con_items(p_sucursal_id uuid, p_fecha date, p_tipo text, p_notas text DEFAULT NULL::text, p_proveedor text DEFAULT NULL::text, p_nro_remito text DEFAULT NULL::text, p_canal text DEFAULT 'consumidor_final'::text, p_personal_id uuid DEFAULT NULL::uuid, p_pago_efectivo numeric DEFAULT NULL::numeric, p_pago_billetera numeric DEFAULT NULL::numeric, p_pago_tarjeta numeric DEFAULT NULL::numeric, p_pago_transferencia numeric DEFAULT NULL::numeric, p_created_by uuid DEFAULT NULL::uuid, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_movimiento_id uuid;
  v_item          jsonb;
  v_product_id    uuid;
  v_stock         numeric;
  v_cantidad      numeric;
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
    v_cantidad := (v_item->>'cantidad')::numeric;

    if p_tipo <> 'ajuste' and v_cantidad <= 0 then
      raise exception 'La cantidad debe ser mayor a 0 para movimientos de tipo %', p_tipo;
    end if;

    insert into movimiento_items (movimiento_id, product_id, cantidad, precio_unitario, subtotal, promo_id)
    values (
      v_movimiento_id,
      (v_item->>'product_id')::uuid,
      v_cantidad,
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
          when m.tipo in ('devolucion','venta','merma') then -mi.cantidad
          else 0
        end), 0)
    into v_stock
    from movimiento_items mi
    join movimientos m on m.id = mi.movimiento_id
    where m.sucursal_id = p_sucursal_id and mi.product_id = v_product_id;

    -- DESACTIVADO TEMPORALMENTE: if v_stock < 0 then raise exception ...; end if;
    null;
  end loop;

  return v_movimiento_id;
end;
$function$;
