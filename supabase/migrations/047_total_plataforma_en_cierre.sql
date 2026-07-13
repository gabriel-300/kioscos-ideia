-- Pedido Ya Plataforma no pasa por caja (paga la app aparte) y por eso queda
-- excluido del total de ventas que concilia contra caja -- pero eso lo hacia
-- invisible en el Informe de cierres, sin ningun lugar donde verlo despues.
-- Se persiste igual que total_fiado (ver 042_total_fiado_en_cierre.sql) para
-- poder mostrarlo ahi como dato informativo, sin mezclarlo con la
-- conciliacion de caja.
--
-- IMPORTANTE (ver fix-cerrar-caja-overload-2026-07-06): cerrar_caja ya fue
-- pisada una vez por un create-or-replace que cambio la firma sin dropear la
-- version vieja, lo que duplico la funcion y reabrio permisos default. Por
-- eso el drop explicito de la firma anterior y el revoke van SIEMPRE
-- acompanando cualquier cambio de firma de esta funcion.

alter table public.cierres_caja add column total_plataforma numeric not null default 0;

drop function if exists public.cerrar_caja(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, numeric, numeric
);

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

revoke execute on function public.cerrar_caja(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.cerrar_caja(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, numeric, numeric, numeric
) to service_role, postgres;
