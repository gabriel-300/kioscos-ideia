-- 096: confirmar_transferencia_stock con bloqueo de fila (auditoría 19/09/2026, H-06).
--
-- Problema: el RPC leía el estado de la transferencia sin bloquearla y recién después tomaba
-- el lock por producto. Dos confirmaciones simultáneas pasaban las dos el chequeo
-- "ya fue confirmada" y cada una insertaba su movimiento de entrada (stock duplicado en el destino).
-- Además la anulación solo se chequeaba en la Server Action, fuera de la transacción.
--
-- Cambio: SELECT ... FOR UPDATE de la fila de transferencias_stock (la segunda confirmación espera,
-- después ve "recibida" y falla) y chequeo de anulada_en dentro del RPC.
--
-- Misma firma que la función viva (5 parámetros, con los DEFAULT de p_recibido_por, p_notas_recepcion y
-- p_items: si se omiten, Postgres rechaza el create or replace con 42P13): no agrega un overload.
-- Idempotente. NO se aplica sola: correrla a mano en el SQL Editor de Supabase.
--
-- Verificación después:
--   select count(*) from pg_proc where proname = 'confirmar_transferencia_stock';   -- debe dar 1
--   select proacl from pg_proc where proname = 'confirmar_transferencia_stock';     -- sin anon/authenticated
--   y confirmar una transferencia real desde la pantalla.

create or replace function public.confirmar_transferencia_stock(
  p_transferencia_id uuid,
  p_fecha            date,
  p_recibido_por     uuid  default null,
  p_notas_recepcion  text  default null,
  p_items            jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_destino_id uuid;
  v_estado              text;
  v_anulada             timestamptz;
  v_movimiento_id        uuid;
  v_item                 jsonb;
  v_ti_id                 uuid;
  v_cantidad              numeric;
  v_product_id            uuid;
begin
  -- FOR UPDATE: bloquea la fila hasta el fin de la transacción. Sin esto, dos confirmaciones
  -- simultáneas (doble clic, dos dispositivos) leían 'enviada' las dos, pasaban el chequeo de abajo
  -- e insertaban cada una su movimiento de entrada: el stock del destino se sumaba dos veces.
  select sucursal_destino_id, estado, anulada_en into v_sucursal_destino_id, v_estado, v_anulada
  from transferencias_stock where id = p_transferencia_id
  for update;

  if v_sucursal_destino_id is null then
    raise exception 'Transferencia no encontrada';
  end if;
  if v_estado = 'recibida' then
    raise exception 'Esta transferencia ya fue confirmada';
  end if;
  if v_anulada is not null then
    raise exception 'Esta transferencia fue anulada';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Faltan las cantidades recibidas';
  end if;

  insert into movimientos (sucursal_id, fecha, tipo, notas, created_by)
  values (v_sucursal_destino_id, p_fecha, 'transferencia_entrada', p_notas_recepcion, p_recibido_por)
  returning id into v_movimiento_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_ti_id    := (v_item->>'transferencia_item_id')::uuid;
    v_cantidad := (v_item->>'cantidad_recibida')::numeric;

    if v_cantidad < 0 then
      raise exception 'La cantidad recibida no puede ser negativa';
    end if;

    select product_id into v_product_id
    from transferencia_items
    where id = v_ti_id and transferencia_id = p_transferencia_id;

    if v_product_id is null then
      raise exception 'Item de transferencia no encontrado';
    end if;

    perform pg_advisory_xact_lock(hashtext(v_sucursal_destino_id::text), hashtext(v_product_id::text));

    update transferencia_items set cantidad_recibida = v_cantidad where id = v_ti_id;

    if v_cantidad > 0 then
      insert into movimiento_items (movimiento_id, product_id, cantidad)
      values (v_movimiento_id, v_product_id, v_cantidad);
    end if;
  end loop;

  update transferencias_stock
  set estado = 'recibida',
      movimiento_entrada_id = v_movimiento_id,
      recibido_por = p_recibido_por,
      confirmado_en = now(),
      notas_recepcion = p_notas_recepcion
  where id = p_transferencia_id;

  return v_movimiento_id;
end;
$$;

-- create or replace conserva los permisos; se repite por si acaso (el RPC solo lo ejecuta service_role).
revoke execute on function public.confirmar_transferencia_stock(uuid, date, uuid, text, jsonb) from public, anon, authenticated;
