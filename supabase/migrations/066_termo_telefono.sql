-- Igual que el DNI: si alguien se lleva un termo, deja el teléfono para poder
-- reclamarle si no lo devuelve. NOT NULL con el mismo criterio que el DNI --
-- las filas de prueba que ya existen se backfillean con un placeholder para
-- poder aplicar la constraint.

alter table public.prestamos_termo add column telefono text;
update public.prestamos_termo set telefono = 'sin dato' where telefono is null;
alter table public.prestamos_termo alter column telefono set not null;

-- prestar_termo cambia de firma (nuevo parámetro p_telefono, sin default,
-- antes de los que sí lo tienen) -- CREATE OR REPLACE con firma distinta crea
-- un overload nuevo en vez de reemplazar (ver 028_fix_cerrar_caja_overload_
-- ambiguity.sql), así que hay que dropear la vieja explícitamente y volver a
-- revocar los grants por defecto después.
drop function if exists public.prestar_termo(uuid, text, text, uuid, uuid);

create function public.prestar_termo(
  p_termo_id      uuid,
  p_dni           text,
  p_telefono      text,
  p_nombre        text default null,
  p_movimiento_id uuid default null,
  p_created_by    uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_estado   text;
  v_sucursal uuid;
  v_id       uuid;
  v_dni      text;
  v_telefono text;
  v_deuda    numeric;
begin
  perform pg_advisory_xact_lock(hashtext('prestamo_termo'), hashtext(p_termo_id::text));

  select estado, sucursal_id into v_estado, v_sucursal
  from termos where id = p_termo_id;

  if v_estado is null then
    raise exception 'Termo no encontrado';
  end if;
  if v_estado <> 'disponible' then
    raise exception 'El termo no está disponible (estado actual: %)', v_estado;
  end if;

  v_dni := trim(coalesce(p_dni, ''));
  if v_dni = '' then
    raise exception 'El DNI es obligatorio para prestar un termo';
  end if;

  v_telefono := trim(coalesce(p_telefono, ''));
  if v_telefono = '' then
    raise exception 'El teléfono es obligatorio para prestar un termo';
  end if;

  select coalesce(sum(monto_multa), 0) into v_deuda
  from prestamos_termo
  where dni = v_dni and monto_multa > 0 and multa_pagada_en is null;

  if v_deuda > 0 then
    raise exception 'Este DNI tiene una multa pendiente de $% -- no se le puede alquilar otro termo hasta que la pague', v_deuda;
  end if;

  update termos set estado = 'prestado' where id = p_termo_id;

  insert into prestamos_termo (termo_id, sucursal_id, dni, telefono, nombre, movimiento_id, prestado_by)
  values (p_termo_id, v_sucursal, v_dni, v_telefono, nullif(trim(coalesce(p_nombre, '')), ''), p_movimiento_id, p_created_by)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.prestar_termo(uuid, text, text, text, uuid, uuid) from public, anon, authenticated;
