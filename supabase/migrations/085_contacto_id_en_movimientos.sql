-- Fase 2 (parte A) del plan de comunidades/rondas: una venta de ronda de
-- entrega necesita poder atribuirse a la persona de contactos_crm que la
-- pidio, para que el CRM de nichos mida conversion real en vez de quedar
-- desconectado de la venta (a diferencia del esquema original propuesto por
-- Javier, que llevaba el pedido en una tabla aparte sin tocar stock -- ver
-- conversacion con Gabriel, set. 2026: eso hubiera dejado el inventario mal,
-- asi que se reusa el mismo circuito de venta que ya existe, con un canal
-- nuevo "ronda_comunidad" -- mismo criterio que ya tiene "ambulante" para
-- ventas fuera del local).
--
-- Esta migracion cubre SOLO el caso "se cobra en el momento" (efectivo/QR
-- MP/etc, igual que Ambulante). La cuenta corriente para clientes externos
-- (Pieza 1B del brief) queda para una migracion aparte -- necesita revisar
-- primero el esquema real de cta_corriente_pagos en la base viva (no quedo
-- versionado con su CREATE TABLE original, ver 050_verificar_rls_cta_corriente_pagos.sql)
-- para no adivinar columnas en una tabla de plata real.

alter table public.movimientos
  add column if not exists contacto_id uuid references public.contactos_crm(id) on delete set null;

create index if not exists movimientos_contacto_id_idx on public.movimientos (contacto_id);

-- ── crear_movimiento_con_items: agrega p_contacto_id ───────────────────────
-- Cambia de firma (15→16 params) -- requiere drop explicito antes del
-- create-or-replace, mismo motivo documentado en 076_proveedor_id_en_movimientos.sql
-- (un create-or-replace con distinta cantidad de parametros crea un OVERLOAD
-- nuevo en vez de reemplazar, rompe PostgREST y nace con EXECUTE abierto a
-- PUBLIC por default).

drop function if exists public.crear_movimiento_con_items(
  uuid, date, text, text, text, uuid, text, text, uuid, numeric, numeric, numeric, numeric, uuid, jsonb
);

create or replace function public.crear_movimiento_con_items(
  p_sucursal_id uuid,
  p_fecha date,
  p_tipo text,
  p_notas text default null::text,
  p_proveedor text default null::text,
  p_proveedor_id uuid default null::uuid,
  p_nro_remito text default null::text,
  p_canal text default 'consumidor_final'::text,
  p_personal_id uuid default null::uuid,
  p_contacto_id uuid default null::uuid,
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
    sucursal_id, fecha, tipo, notas, proveedor, proveedor_id, nro_remito,
    canal, personal_id, contacto_id,
    pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia,
    created_by
  ) values (
    p_sucursal_id, p_fecha, p_tipo, p_notas, p_proveedor, p_proveedor_id, p_nro_remito,
    p_canal, p_personal_id, p_contacto_id,
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
  -- cliente (ver comentario de la migracion 053). Sin cambios: la cuenta
  -- corriente de clientes externos (contacto_id) todavia no tiene limite
  -- propio, queda para la migracion siguiente.
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

revoke execute on function public.crear_movimiento_con_items(
  uuid, date, text, text, text, uuid, text, text, uuid, uuid, numeric, numeric, numeric, numeric, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.crear_movimiento_con_items(
  uuid, date, text, text, text, uuid, text, text, uuid, uuid, numeric, numeric, numeric, numeric, uuid, jsonb
) to service_role, postgres;
