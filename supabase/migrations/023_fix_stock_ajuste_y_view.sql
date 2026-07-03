-- ============================================================
-- FIX: 4 hallazgos críticos de un análisis de lógica (2026-07-03)
--
-- 1. "Ajuste de stock" no afectaba stock_actual (stock_sucursal no
--    contemplaba tipo='ajuste'). Se agrega sentido sumar/restar via el
--    signo de movimiento_items.cantidad (antes solo se permitía > 0).
-- 2. Retiros de efectivo no se descontaban en el cierre de caja.
--    Se agrega cierres_caja.retiros_turno (calculado server-side por
--    cerrar_caja) y se ajusta la fórmula de la columna generada.
-- 3. Sin control de stock en el servidor (todo client-side). Se agrega
--    un chequeo post-insert dentro de crear_movimiento_con_items con
--    advisory lock, que revierte toda la operación si algún producto
--    quedaría con stock negativo.
-- 4. Race condition en apertura/cierre de caja (leer-validar-insertar
--    no atómico). Se reemplaza por RPCs abrir_caja/cerrar_caja con
--    pg_advisory_xact_lock por sucursal.
--
-- Aplicada en producción vía Management API/MCP el 2026-07-03.
-- ============================================================

-- ── 1a. Permitir cantidad negativa (ajustes "restar") ──────────────
alter table public.movimiento_items drop constraint if exists movimiento_items_cantidad_check;
alter table public.movimiento_items add constraint movimiento_items_cantidad_check check (cantidad <> 0);

-- ── 1b. Recrear stock_sucursal contemplando ajustes con signo ──────
-- (definición previa obtenida con pg_get_viewdef; sacamos los casts
-- ::integer, que truncaban el stock de productos por kg — por eso
-- cambia el tipo de columna y hace falta DROP en vez de CREATE OR REPLACE)
drop view if exists stock_sucursal;
create view stock_sucursal as
select
  m.sucursal_id,
  mi.product_id,
  p.name as product_name,
  p.sku,
  sum(case
        when m.tipo = 'entrega' then mi.cantidad
        when m.tipo = 'ajuste' and mi.cantidad > 0 then mi.cantidad
        else 0
      end) as entradas,
  sum(case
        when m.tipo in ('devolucion','venta') then mi.cantidad
        when m.tipo = 'ajuste' and mi.cantidad < 0 then abs(mi.cantidad)
        else 0
      end) as salidas,
  sum(case
        when m.tipo = 'entrega' then mi.cantidad
        when m.tipo = 'ajuste' then mi.cantidad
        when m.tipo in ('devolucion','venta') then -mi.cantidad
        else 0
      end) as stock_actual
from movimiento_items mi
join movimientos m on m.id = mi.movimiento_id
join products p on p.id = mi.product_id
group by m.sucursal_id, mi.product_id, p.name, p.sku;

grant select, insert, update, delete, truncate, references, trigger on stock_sucursal to authenticated, anon, service_role, postgres;

-- ── 3. Control de stock server-side dentro de crear_movimiento_con_items ──
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

  -- Verificación de stock: para cada producto distinto tocado en este batch,
  -- lockear (evita carreras entre ventas concurrentes) y recalcular el stock
  -- resultante directo desde movimientos/movimiento_items (ve las filas recién
  -- insertadas, misma transacción). Si algún producto queda negativo, se
  -- revierte TODA la operación.
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

    if v_stock < 0 then
      raise exception 'Stock insuficiente para el producto %: quedaría en %', v_product_id, v_stock;
    end if;
  end loop;

  return v_movimiento_id;
end;
$$;

-- ── 2 + 4. RPCs atómicos para apertura y cierre de caja ────────────
alter table public.cierres_caja add column if not exists retiros_turno numeric not null default 0;

-- La columna generada no se puede ALTER, hay que recrearla
alter table public.cierres_caja drop column if exists diferencia;
alter table public.cierres_caja add column diferencia numeric generated always as (
  (efectivo_declarado - fondo_inicial + retiros_turno)
  + billetera_declarada
  + coalesce(tarjeta_declarada, 0)
  + coalesce(transferencia_declarada, 0)
  - total_ventas
) stored;

create or replace function abrir_caja(
  p_sucursal_id   uuid,
  p_fecha         date,
  p_fondo_inicial numeric,
  p_notas         text,
  p_created_by    uuid
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id               uuid;
  v_ultima_apertura  timestamptz;
  v_ultimo_cierre    timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_sucursal_id::text));

  select created_at into v_ultima_apertura
  from aperturas_caja where sucursal_id = p_sucursal_id
  order by created_at desc limit 1;

  if v_ultima_apertura is not null then
    select created_at into v_ultimo_cierre
    from cierres_caja where sucursal_id = p_sucursal_id
    order by created_at desc limit 1;

    if v_ultimo_cierre is null or v_ultima_apertura > v_ultimo_cierre then
      raise exception 'La caja ya está abierta';
    end if;
  end if;

  insert into aperturas_caja (sucursal_id, fecha, fondo_inicial, notas, created_by)
  values (p_sucursal_id, p_fecha, p_fondo_inicial, p_notas, p_created_by)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function cerrar_caja(
  p_sucursal_id              uuid,
  p_fecha                    date,
  p_fondo_inicial            numeric,
  p_total_ventas             numeric,
  p_efectivo_declarado       numeric,
  p_billetera_declarada      numeric,
  p_tarjeta_declarada        numeric,
  p_transferencia_declarada  numeric,
  p_notas                    text,
  p_created_by               uuid
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id               uuid;
  v_ultima_apertura  timestamptz;
  v_ultimo_cierre    timestamptz;
  v_retiros_turno    numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_sucursal_id::text));

  select created_at into v_ultima_apertura
  from aperturas_caja where sucursal_id = p_sucursal_id
  order by created_at desc limit 1;

  if v_ultima_apertura is null then
    raise exception 'No hay apertura de caja registrada';
  end if;

  select created_at into v_ultimo_cierre
  from cierres_caja where sucursal_id = p_sucursal_id
  order by created_at desc limit 1;

  if v_ultimo_cierre is not null and v_ultimo_cierre >= v_ultima_apertura then
    raise exception 'La caja ya está cerrada';
  end if;

  select coalesce(sum(monto), 0) into v_retiros_turno
  from retiros_caja
  where sucursal_id = p_sucursal_id and created_at >= v_ultima_apertura;

  insert into cierres_caja (
    sucursal_id, fecha, fondo_inicial, total_ventas,
    efectivo_declarado, billetera_declarada, tarjeta_declarada, transferencia_declarada,
    retiros_turno, notas, created_by
  ) values (
    p_sucursal_id, p_fecha, p_fondo_inicial, p_total_ventas,
    p_efectivo_declarado, p_billetera_declarada, p_tarjeta_declarada, p_transferencia_declarada,
    v_retiros_turno, p_notas, p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;
