-- Auditoria 15/07, medio deliberadamente sin tocar en su momento: el limite
-- de credito de Cta. Corriente se chequeaba en movimientos/actions.ts, en un
-- round-trip separado ANTES de llamar a este RPC. Dos ventas fiado
-- simultaneas del mismo personal_id podian leer el mismo saldo "todavia
-- dentro del limite" cada una por separado, y terminar superando el limite
-- entre las dos -- el unico lock que existia era por producto (stock), no
-- por personal_id.
--
-- Se mueve el chequeo ADENTRO de crear_movimiento_con_items, con un
-- pg_advisory_xact_lock por personal_id: la segunda transaccion concurrente
-- espera a que la primera termine (commit o rollback) antes de leer el
-- saldo, asi que ya ve la venta de la otra reflejada en la deuda. Mismo
-- signature (CREATE OR REPLACE sin drop, no cambia ningun parametro).

create or replace function public.crear_movimiento_con_items(
  p_sucursal_id uuid,
  p_fecha date,
  p_tipo text,
  p_notas text default null::text,
  p_proveedor text default null::text,
  p_nro_remito text default null::text,
  p_canal text default 'consumidor_final'::text,
  p_personal_id uuid default null::uuid,
  p_pago_efectivo numeric default null::numeric,
  p_pago_billetera numeric default null::numeric,
  p_pago_tarjeta numeric default null::numeric,
  p_pago_transferencia numeric default null::numeric,
  p_created_by uuid default null::uuid,
  p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_limite        numeric;
  v_deuda         numeric;
  v_pagado        numeric;
  v_saldo         numeric;
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

  -- Limite de credito de Cta. Corriente -- lock por personal_id para cerrar
  -- la ventana de carrera entre dos ventas fiado simultaneas del mismo
  -- cliente (ver comentario de la migracion arriba).
  if p_tipo = 'venta' and p_canal = 'cuenta_corriente' and p_personal_id is not null then
    perform pg_advisory_xact_lock(hashtext('cta_corriente_limite'), hashtext(p_personal_id::text));

    select credito_limite into v_limite from profiles where id = p_personal_id;

    if v_limite is not null then
      select coalesce(sum(mi.subtotal), 0) into v_deuda
      from movimientos m
      join movimiento_items mi on mi.movimiento_id = m.id
      where m.sucursal_id = p_sucursal_id
        and m.personal_id = p_personal_id
        and m.canal = 'cuenta_corriente'
        and m.tipo = 'venta';

      select coalesce(sum(monto), 0) into v_pagado
      from cta_corriente_pagos
      where sucursal_id = p_sucursal_id and personal_id = p_personal_id;

      v_saldo := v_deuda - v_pagado;

      if round(v_saldo * 100) > round(v_limite * 100) then
        raise exception 'Esta venta supera el límite de crédito de Cta. Corriente (saldo % , límite %)', v_saldo, v_limite;
      end if;
    end if;
  end if;

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
