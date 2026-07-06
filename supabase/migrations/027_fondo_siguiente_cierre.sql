-- Permite declarar, al cerrar caja, cuanto efectivo se deja en el cajon para el
-- proximo turno (separado del total contado) -- resuelve la confusion de que el
-- "Efectivo" del informe incluye plata que en realidad quedo adentro, no se
-- retiro/entrego. Ese valor tambien sirve para sugerir (no forzar) el fondo
-- inicial de la proxima apertura.
alter table public.cierres_caja add column if not exists fondo_siguiente numeric;

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
  p_created_by               uuid,
  p_fondo_siguiente          numeric default null
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
    retiros_turno, notas, created_by, fondo_siguiente
  ) values (
    p_sucursal_id, p_fecha, p_fondo_inicial, p_total_ventas,
    p_efectivo_declarado, p_billetera_declarada, p_tarjeta_declarada, p_transferencia_declarada,
    v_retiros_turno, p_notas, p_created_by, p_fondo_siguiente
  )
  returning id into v_id;

  return v_id;
end;
$$;
