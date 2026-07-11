-- Merma de coccion automatica: hay productos que se cargan al stock
-- CONGELADOS pero se venden COCIDOS (ej. Chipa Bocadito, comprada a
-- Enminutas). Al cocinar pierden peso -- 1 kg congelado rinde 0.85 kg
-- cocido, un 15% de merma sobre el congelado. Hasta ahora esa perdida
-- nunca se registraba, lo que hacia que el stock calculado se fuera
-- desviando del conteo fisico con el tiempo (mismo patron para cualquier
-- producto congelado-que-se-cocina, no solo la chipa).
--
-- products.merma_coccion_pct: fraccion del peso CONGELADO que se pierde al
-- cocinar (0.15 = pierde 15%). NULL o 0 = sin merma automatica (default,
-- no afecta a ningun otro producto).
--
-- La merma se carga en el momento de la VENTA (no al "cocinar"), porque no
-- hay un evento de coccion registrado por separado: kg congelado a
-- descontar = kg vendido (cocido) / (1 - pct). La diferencia contra lo que
-- ya se descuenta por la venta misma (kg vendido) se carga como un
-- movimiento de merma aparte, vinculado, asi queda visible y costeado en
-- /admin/mermas en vez de perderse en un ajuste sin motivo.

alter table public.products
  add column merma_coccion_pct numeric check (merma_coccion_pct is null or (merma_coccion_pct >= 0 and merma_coccion_pct < 1));

update public.products set merma_coccion_pct = 0.15 where sku = 'KIO-0100';

-- crear_movimiento_con_items: misma firma exacta que la version anterior
-- (042_tipo_merma.sql) -- create or replace es seguro aca, no hay riesgo de
-- overload porque no se agrega/quita ningun parametro.
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
  v_merma_id      uuid;
  v_merma_pct     numeric;
  v_merma_cant    numeric;
  v_any_merma     boolean := false;
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

  -- Merma de coccion automatica (solo en ventas): por cada producto vendido
  -- con merma_coccion_pct configurado, se genera un movimiento de merma
  -- aparte por la diferencia entre lo vendido (cocido) y lo que realmente
  -- salio del freezer (congelado).
  if p_tipo = 'venta' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_product_id := (v_item->>'product_id')::uuid;
      v_cantidad   := (v_item->>'cantidad')::numeric;

      select merma_coccion_pct into v_merma_pct
      from products where id = v_product_id;

      if v_merma_pct is not null and v_merma_pct > 0 then
        if not v_any_merma then
          insert into movimientos (sucursal_id, fecha, tipo, notas, canal, created_by)
          values (
            p_sucursal_id, p_fecha, 'merma',
            'Merma de cocción automática (congelado → cocido) generada por la venta',
            p_canal, p_created_by
          )
          returning id into v_merma_id;
          v_any_merma := true;
        end if;

        v_merma_cant := v_cantidad * (v_merma_pct / (1 - v_merma_pct));

        insert into movimiento_items (movimiento_id, product_id, cantidad)
        values (v_merma_id, v_product_id, v_merma_cant);
      end if;
    end loop;
  end if;

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
