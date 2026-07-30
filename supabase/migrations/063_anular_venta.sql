-- Anular una venta cargada por error (ej. duplicada), mientras la caja de
-- ese turno siga abierta. No es un borrado -- queda marcada (quién, cuándo,
-- motivo obligatorio) y a partir de ahí se excluye de stock/caja/informes,
-- pero sigue visible en el Historial para trazabilidad (mismo criterio que
-- mermas/diferencias de caja: cualquier ajuste de plata o stock deja rastro).
--
-- El límite de turno ("no se puede anular si la caja ya cerró") se valida
-- en la server action (movimientos/actions.ts, función anularVenta), no acá
-- -- esta migración solo agrega las columnas y actualiza los cálculos que
-- suman ventas para que ignoren las anuladas.

alter table public.movimientos
  add column if not exists anulado_en       timestamptz,
  add column if not exists anulado_por      uuid references auth.users(id),
  add column if not exists motivo_anulacion text;

-- ── stock_sucursal (vigente desde 042_tipo_merma.sql) ──────────────────────
create or replace view public.stock_sucursal
with (security_invoker = on)
as
 select m.sucursal_id,
    mi.product_id,
    p.name as product_name,
    p.sku,
    sum(
        case
            when m.anulado_en is not null then 0
            when m.tipo = 'entrega' then mi.cantidad
            when m.tipo = 'ajuste' and mi.cantidad > 0 then mi.cantidad
            else 0
        end) as entradas,
    sum(
        case
            when m.anulado_en is not null then 0
            when m.tipo = any (array['devolucion', 'venta', 'merma']) then mi.cantidad
            when m.tipo = 'ajuste' and mi.cantidad < 0 then abs(mi.cantidad)
            else 0
        end) as salidas,
    sum(
        case
            when m.anulado_en is not null then 0
            when m.tipo = 'entrega' then mi.cantidad
            when m.tipo = 'ajuste' then mi.cantidad
            when m.tipo = any (array['devolucion', 'venta', 'merma']) then -mi.cantidad
            else 0
        end) as stock_actual
   from movimiento_items mi
     join movimientos m on m.id = mi.movimiento_id
     join products p on p.id = mi.product_id
  group by m.sucursal_id, mi.product_id, p.name, p.sku;

-- ── crear_movimiento_con_items (vigente desde 053_limite_credito_dentro_del_rpc.sql) ──
-- Misma firma (14 parámetros, sin cambios) -- create-or-replace en el lugar,
-- no hace falta drop/revoke (eso solo aplica cuando cambia la firma, ver
-- fix-cerrar-caja-overload-2026-07-06). Se agrega "and m.anulado_en is null"
-- al límite de crédito de Cta. Corriente y al chequeo de stock (hoy inerte).
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
  -- cliente (ver comentario de la migracion 053).
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
        and m.tipo = 'venta'
        and m.anulado_en is null;

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
          when m.anulado_en is not null then 0
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
