-- Módulo de Tesorería, paso 3/8: movimientos.proveedor es texto libre desde
-- siempre (019/009), nunca fue FK a proveedores.id. El formulario de
-- entregas ya ofrece un <select> de proveedores.nombre cuando hay
-- proveedores cargados -- el texto libre queda vestigial (mismo criterio que
-- products.precio_dist tras 059 o promos.price tras 070), no se borra por
-- compatibilidad con entregas viejas cargadas a mano o con la lectura de
-- remito por IA. Sin esta columna, "Pagos a Proveedores" no puede calcular
-- deuda por proveedor de forma confiable.

alter table public.movimientos
  add column if not exists proveedor_id uuid references public.proveedores(id) on delete set null;

create index if not exists movimientos_proveedor_id_idx on public.movimientos (proveedor_id);

-- Backfill best-effort por nombre normalizado (trim + lower) -- solo cuando
-- hay UN único proveedor que matchea exacto. Si dos proveedores comparten
-- nombre normalizado se deja null a propósito: mejor sin vincular que
-- vinculado mal en un módulo de plata real.
update public.movimientos m
set proveedor_id = p.id
from public.proveedores p
where m.tipo = 'entrega'
  and m.proveedor_id is null
  and m.proveedor is not null
  and trim(lower(m.proveedor)) = trim(lower(p.nombre))
  and (
    select count(*) from public.proveedores p2
    where trim(lower(p2.nombre)) = trim(lower(m.proveedor))
  ) = 1;

-- ── crear_movimiento_con_items: agrega p_proveedor_id ──────────────────────
-- Cambia de firma (14→15 params) -- Postgres identifica funciones por
-- nombre+tipos de parámetros, así que un create-or-replace con distinta
-- cantidad de parámetros crea un OVERLOAD NUEVO en vez de reemplazar (mismo
-- incidente ya documentado en 028_fix_cerrar_caja_overload_ambiguity.sql):
-- rompe PostgREST ("Could not choose the best candidate function") y la
-- función nueva nace con EXECUTE abierto a PUBLIC por default, reabriendo el
-- hardening de 025_security_lockdown_rpc_and_stock_view.sql. Por eso acá SÍ
-- hace falta el drop explícito de la firma vieja antes del create-or-replace
-- (a diferencia de cerrar_caja en la migración de conciliación, que no
-- cambia de firma).

drop function if exists public.crear_movimiento_con_items(
  uuid, date, text, text, text, text, text, uuid, numeric, numeric, numeric, numeric, uuid, jsonb
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
    canal, personal_id,
    pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia,
    created_by
  ) values (
    p_sucursal_id, p_fecha, p_tipo, p_notas, p_proveedor, p_proveedor_id, p_nro_remito,
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

revoke execute on function public.crear_movimiento_con_items(
  uuid, date, text, text, text, uuid, text, text, uuid, numeric, numeric, numeric, numeric, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.crear_movimiento_con_items(
  uuid, date, text, text, text, uuid, text, text, uuid, numeric, numeric, numeric, numeric, uuid, jsonb
) to service_role, postgres;
