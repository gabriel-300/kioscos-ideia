-- Agrega un numero de liquidacion secuencial POR SUCURSAL a cierres_caja, para que
-- el vendedor lo anote en el sobre de efectivo y el tesorero lo pueda cruzar rapido
-- contra el sistema (el uuid interno no sirve para escribir a mano).
--
-- IMPORTANTE: cerrar_caja mantiene EXACTAMENTE la misma firma (mismos parametros)
-- que la version anterior -- create or replace function con la MISMA firma
-- reemplaza la funcion existente sin crear un overload nuevo. Si en el futuro se
-- le agrega/saca/reordena un parametro, hay que dropear la firma vieja explicita
-- y volver a aplicar los revoke (ver incidente documentado en
-- 028_fix_cerrar_caja_overload_ambiguity.sql).

alter table public.cierres_caja add column if not exists numero_liquidacion integer;

-- Backfill: numera los cierres existentes de cada sucursal en orden cronologico.
with numerados as (
  select id, row_number() over (partition by sucursal_id order by created_at asc) as rn
  from public.cierres_caja
)
update public.cierres_caja c
set numero_liquidacion = n.rn
from numerados n
where c.id = n.id and c.numero_liquidacion is null;

alter table public.cierres_caja
  add constraint cierres_caja_sucursal_numero_liquidacion_key unique (sucursal_id, numero_liquidacion);

create or replace function public.cerrar_caja(
  p_sucursal_id uuid, p_fecha date, p_fondo_inicial numeric, p_total_ventas numeric,
  p_efectivo_declarado numeric, p_billetera_declarada numeric, p_tarjeta_declarada numeric,
  p_transferencia_declarada numeric, p_notas text, p_created_by uuid,
  p_fondo_siguiente numeric default null
) returns uuid
language plpgsql
security definer
as $function$
declare
  v_id                  uuid;
  v_ultima_apertura     timestamptz;
  v_ultimo_cierre       timestamptz;
  v_retiros_turno       numeric;
  v_numero_liquidacion  integer;
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

  select coalesce(max(numero_liquidacion), 0) + 1 into v_numero_liquidacion
  from cierres_caja
  where sucursal_id = p_sucursal_id;

  insert into cierres_caja (
    sucursal_id, fecha, fondo_inicial, total_ventas,
    efectivo_declarado, billetera_declarada, tarjeta_declarada, transferencia_declarada,
    retiros_turno, notas, created_by, fondo_siguiente, numero_liquidacion
  ) values (
    p_sucursal_id, p_fecha, p_fondo_inicial, p_total_ventas,
    p_efectivo_declarado, p_billetera_declarada, p_tarjeta_declarada, p_transferencia_declarada,
    v_retiros_turno, p_notas, p_created_by, p_fondo_siguiente, v_numero_liquidacion
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke execute on function public.cerrar_caja(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, numeric
) from public, anon, authenticated;
