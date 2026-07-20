-- El personal cerraba la caja sin preocuparse por la diferencia (a favor o
-- en contra) porque no había ninguna consecuencia real -- solo se veía
-- coloreada en el resumen. A pedido del usuario: si al cerrar la caja queda
-- una diferencia distinta de cero, ahora es OBLIGATORIO explicar qué pasó
-- en las notas. Se valida en el cliente (cierre-caja-modal.tsx) pero
-- también acá, porque el cliente nunca es la fuente de verdad para reglas
-- de negocio -- alguien le podría pegar directo al RPC con devtools.
--
-- IMPORTANTE (ver fix-cerrar-caja-overload-2026-07-06): esta función ya fue
-- pisada una vez por un create-or-replace que cambió la firma sin dropear
-- la versión vieja, duplicando la función y reabriendo permisos default.
-- Acá la firma NO cambia (mismos 13 parámetros que 047_total_plataforma_en_cierre.sql,
-- mismo orden y tipos) -- create-or-replace con firma idéntica reemplaza en
-- el lugar y conserva los grants existentes, no hace falta drop/revoke.

create or replace function public.cerrar_caja(
  p_sucursal_id              uuid,
  p_fecha                    date,
  p_fondo_inicial            numeric,
  p_total_ventas             numeric,
  p_efectivo_declarado       numeric,
  p_billetera_declarada      numeric,
  p_tarjeta_declarada        numeric,
  p_transferencia_declarada  numeric,
  p_notas                    text,
  p_created_by               uuid,
  p_fondo_siguiente          numeric default null,
  p_total_fiado              numeric default 0,
  p_total_plataforma         numeric default 0
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id                  uuid;
  v_ultima_apertura     timestamptz;
  v_ultimo_cierre       timestamptz;
  v_retiros_turno       numeric;
  v_numero_liquidacion  integer;
  v_diferencia          numeric;
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

  -- Misma fórmula que la columna generada cierres_caja.diferencia
  -- (ver 023_fix_stock_ajuste_y_view.sql).
  v_diferencia := (p_efectivo_declarado - p_fondo_inicial + v_retiros_turno)
    + p_billetera_declarada + coalesce(p_tarjeta_declarada, 0) + coalesce(p_transferencia_declarada, 0)
    - p_total_ventas;

  if v_diferencia <> 0 and trim(coalesce(p_notas, '')) = '' then
    raise exception 'Hay una diferencia de caja -- contá qué pasó en las notas antes de cerrar';
  end if;

  select coalesce(max(numero_liquidacion), 0) + 1 into v_numero_liquidacion
  from cierres_caja
  where sucursal_id = p_sucursal_id;

  insert into cierres_caja (
    sucursal_id, fecha, fondo_inicial, total_ventas,
    efectivo_declarado, billetera_declarada, tarjeta_declarada, transferencia_declarada,
    retiros_turno, notas, created_by, fondo_siguiente, numero_liquidacion, total_fiado, total_plataforma
  ) values (
    p_sucursal_id, p_fecha, p_fondo_inicial, p_total_ventas,
    p_efectivo_declarado, p_billetera_declarada, p_tarjeta_declarada, p_transferencia_declarada,
    v_retiros_turno, p_notas, p_created_by, p_fondo_siguiente, v_numero_liquidacion, p_total_fiado, p_total_plataforma
  )
  returning id into v_id;

  return v_id;
end;
$$;
