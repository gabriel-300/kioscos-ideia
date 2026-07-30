-- Multa por atraso en el alquiler de termos (ver 062_termos_alquiler.sql).
-- A pedido del usuario: cada sucursal define cuántas horas de gracia tiene
-- el alquiler y cuánto se cobra por cada hora (o fracción) de atraso más
-- allá de eso -- arranca en 0 (sin multa) hasta que el usuario cargue una
-- tarifa real desde /admin/termos. Si el estudiante no paga al devolver, la
-- deuda queda asociada al DNI (no a un usuario del sistema) y bloquea
-- nuevos alquileres a ESE DNI hasta que se salde -- el termo en sí vuelve a
-- estar disponible igual, se recupera el objeto físico aunque no se cobre.

alter table public.sucursales
  add column if not exists termo_horas_limite      numeric not null default 6,
  add column if not exists termo_tarifa_multa_hora  numeric not null default 0;

alter table public.prestamos_termo
  add column if not exists monto_multa         numeric not null default 0,
  add column if not exists multa_movimiento_id uuid references public.movimientos(id) on delete set null,
  add column if not exists multa_pagada_en     timestamptz;

-- El cobro de la multa se registra como una venta más (mismo criterio que
-- pidió el usuario: "como un cobro más de caja"), para que entre a la
-- conciliación del cierre de turno sin tocar esa lógica -- ya está muy
-- probada y no hace falta reinventarla acá. Para eso el movimiento necesita
-- un product_id real (movimiento_items.product_id es NOT NULL), así que se
-- crea un producto de servicio ficticio: no se vende desde la grilla del POS
-- (vendible_pos=false) y se excluye a mano de /admin/stock y de los
-- selectores de Entrega/Merma/Ajuste (ver .neq("sku","MULTA-TERMO") en esas
-- páginas) porque no tiene stock real -- el "stock" le quedaría cada vez más
-- negativo si no se lo excluyera.
insert into public.products (sku, slug, name, unit_label, vendible_pos, is_active, stock_minimo)
values ('MULTA-TERMO', 'multa-termo', 'Multa por atraso — termo', 'unidad', false, true, 0)
on conflict (sku) do nothing;

insert into public.product_prices (product_id, sucursal_id, precio_dist, costo)
select p.id, s.id, 0, 0
from public.products p
cross join public.sucursales s
where p.sku = 'MULTA-TERMO'
on conflict (product_id, sucursal_id) do nothing;

-- prestar_termo: mismo signature que 062 (create or replace in place, sin
-- perder los grants) -- se le agrega el bloqueo por deuda pendiente.
create or replace function public.prestar_termo(
  p_termo_id      uuid,
  p_dni           text,
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

  select coalesce(sum(monto_multa), 0) into v_deuda
  from prestamos_termo
  where dni = v_dni and monto_multa > 0 and multa_pagada_en is null;

  if v_deuda > 0 then
    raise exception 'Este DNI tiene una multa pendiente de $% -- no se le puede alquilar otro termo hasta que la pague', v_deuda;
  end if;

  update termos set estado = 'prestado' where id = p_termo_id;

  insert into prestamos_termo (termo_id, sucursal_id, dni, nombre, movimiento_id, prestado_by)
  values (p_termo_id, v_sucursal, v_dni, nullif(trim(coalesce(p_nombre, '')), ''), p_movimiento_id, p_created_by)
  returning id into v_id;

  return v_id;
end;
$$;

-- devolver_termo cambia de "returns void" a "returns numeric" (el monto de
-- multa recién calculado) -- Postgres no permite cambiar el tipo de retorno
-- con CREATE OR REPLACE, así que hay que dropearla primero. Mismo criterio
-- de fix-cerrar-caja-overload: después del drop, los grants por defecto se
-- resetean a PUBLIC, así que el revoke de más abajo es obligatorio, no
-- opcional.
drop function if exists public.devolver_termo(uuid, uuid);

create function public.devolver_termo(
  p_prestamo_id uuid,
  p_devuelto_by uuid default null
) returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_termo_id       uuid;
  v_sucursal_id    uuid;
  v_fecha_prestamo timestamptz;
  v_devolucion     timestamptz;
  v_horas_limite   numeric;
  v_tarifa         numeric;
  v_horas_atraso   numeric;
  v_monto_multa    numeric;
begin
  select termo_id, sucursal_id, fecha_prestamo, fecha_devolucion
    into v_termo_id, v_sucursal_id, v_fecha_prestamo, v_devolucion
  from prestamos_termo where id = p_prestamo_id;

  if v_termo_id is null then
    raise exception 'Préstamo no encontrado';
  end if;
  if v_devolucion is not null then
    raise exception 'Este préstamo ya fue devuelto';
  end if;

  perform pg_advisory_xact_lock(hashtext('prestamo_termo'), hashtext(v_termo_id::text));

  select termo_horas_limite, termo_tarifa_multa_hora into v_horas_limite, v_tarifa
  from sucursales where id = v_sucursal_id;

  -- Horas de atraso más allá del límite, redondeadas para arriba -- 10
  -- minutos de atraso ya cuentan como 1 hora completa (mismo criterio que
  -- una playa de estacionamiento), no hace falta ser exactos al segundo.
  -- El usuario avisó que a veces tardan más de un día -- no hay tope, se
  -- sigue acumulando por cada hora que pase.
  v_horas_atraso := greatest(0, ceil(
    extract(epoch from (now() - v_fecha_prestamo)) / 3600.0 - coalesce(v_horas_limite, 6)
  ));
  v_monto_multa := v_horas_atraso * coalesce(v_tarifa, 0);

  update prestamos_termo
  set fecha_devolucion = now(), devuelto_by = p_devuelto_by, monto_multa = v_monto_multa
  where id = p_prestamo_id;

  update termos set estado = 'disponible' where id = v_termo_id;

  return v_monto_multa;
end;
$$;

revoke execute on function public.prestar_termo   from public, anon, authenticated;
revoke execute on function public.devolver_termo  from public, anon, authenticated;
