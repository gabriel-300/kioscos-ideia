-- Módulo de Tesorería, paso 8/8 (último, a propósito -- ver orden de build
-- en el plan): conecta pagos_proveedor, movimientos_socio/pagos_socio y el
-- lado EFECTIVO de cta_corriente_pagos (074) a la conciliación de cierre de
-- caja. Firma de cerrar_caja SIN CAMBIOS (13 params, sumas nuevas inline,
-- mismo criterio que retiros_turno) -- create-or-replace seguro en el lugar,
-- no hace falta drop/revoke (a diferencia de crear_movimiento_con_items en
-- 076, que sí cambió de firma).
--
-- Alcance deliberado: SOLO el componente efectivo de estas tablas entra a la
-- fórmula. El componente billetera queda informativo (mismo criterio que
-- total_fiado/total_plataforma) -- billetera_declarada se recalcula
-- server-side desde movimientos SOLO para encargado/vendedor
-- (cierre-actions.ts), pero se toma tal cual la tipea el admin; mezclar acá
-- un ajuste de billetera sin tocar ese recálculo non-admin generaría una
-- diferencia falsa para un rol y correcta para el otro -- queda para v2.
--
-- Signos (mismo criterio que retiros_turno):
--   + retiros_socio_turno   (socio saca efectivo del cajón -- sale plata)
--   + pagos_proveedor_turno (se le paga a un proveedor en efectivo -- sale plata)
--   − pagos_ctc_turno       (un cliente salda fiado viejo en efectivo -- entra plata que no es venta de hoy)
--   − pagos_socio_turno     (un socio devuelve en efectivo -- entra plata que no es venta de hoy)

alter table public.cierres_caja
  add column if not exists pagos_ctc_turno       numeric not null default 0,
  add column if not exists pagos_proveedor_turno numeric not null default 0,
  add column if not exists retiros_socio_turno   numeric not null default 0,
  add column if not exists pagos_socio_turno     numeric not null default 0;

alter table public.cierres_caja drop column diferencia;
alter table public.cierres_caja add column diferencia numeric generated always as (
  (efectivo_declarado - fondo_inicial + retiros_turno + retiros_socio_turno + pagos_proveedor_turno
    - pagos_ctc_turno - pagos_socio_turno)
  + billetera_declarada + coalesce(tarjeta_declarada, 0) + coalesce(transferencia_declarada, 0)
  - total_ventas
) stored;

create or replace function public.cerrar_caja(
  p_sucursal_id uuid,
  p_fecha date,
  p_fondo_inicial numeric,
  p_total_ventas numeric,
  p_efectivo_declarado numeric,
  p_billetera_declarada numeric,
  p_tarjeta_declarada numeric,
  p_transferencia_declarada numeric,
  p_notas text,
  p_created_by uuid,
  p_fondo_siguiente numeric default null,
  p_total_fiado numeric default 0,
  p_total_plataforma numeric default 0
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id                    uuid;
  v_ultima_apertura       timestamptz;
  v_ultimo_cierre         timestamptz;
  v_retiros_turno         numeric;
  v_pagos_ctc_turno       numeric;
  v_pagos_proveedor_turno numeric;
  v_retiros_socio_turno   numeric;
  v_pagos_socio_turno     numeric;
  v_numero_liquidacion    integer;
  v_diferencia            numeric;
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

  select coalesce(sum(monto_efectivo), 0) into v_pagos_ctc_turno
  from cta_corriente_pagos
  where sucursal_id = p_sucursal_id and created_at >= v_ultima_apertura;

  select coalesce(sum(monto_efectivo), 0) into v_pagos_proveedor_turno
  from pagos_proveedor
  where sucursal_id = p_sucursal_id and created_at >= v_ultima_apertura;

  select coalesce(sum(monto), 0) into v_retiros_socio_turno
  from movimientos_socio
  where sucursal_id = p_sucursal_id and created_at >= v_ultima_apertura;

  select coalesce(sum(monto_efectivo), 0) into v_pagos_socio_turno
  from pagos_socio
  where sucursal_id = p_sucursal_id and created_at >= v_ultima_apertura;

  -- Misma fórmula que la columna generada cierres_caja.diferencia (ver arriba).
  v_diferencia := (p_efectivo_declarado - p_fondo_inicial + v_retiros_turno + v_retiros_socio_turno + v_pagos_proveedor_turno
      - v_pagos_ctc_turno - v_pagos_socio_turno)
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
    retiros_turno, pagos_ctc_turno, pagos_proveedor_turno, retiros_socio_turno, pagos_socio_turno,
    notas, created_by, fondo_siguiente, numero_liquidacion, total_fiado, total_plataforma
  ) values (
    p_sucursal_id, p_fecha, p_fondo_inicial, p_total_ventas,
    p_efectivo_declarado, p_billetera_declarada, p_tarjeta_declarada, p_transferencia_declarada,
    v_retiros_turno, v_pagos_ctc_turno, v_pagos_proveedor_turno, v_retiros_socio_turno, v_pagos_socio_turno,
    p_notas, p_created_by, p_fondo_siguiente, v_numero_liquidacion, p_total_fiado, p_total_plataforma
  )
  returning id into v_id;

  return v_id;
end;
$$;
