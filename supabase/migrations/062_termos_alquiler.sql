-- Alquiler de termos (kiosco UNAM): el estudiante deja el DNI y se lleva un
-- termo numerado + mate + bombilla (no se numeran aparte -- viajan siempre
-- pegados al termo) mientras el kiosco vende la promo "Termo Mate"/"Termo
-- Tereré" de siempre (yerba/hielo se descuentan como cualquier receta, sin
-- cambios ahí). Lo nuevo es solo el seguimiento de "qué termo salió, a
-- nombre de qué DNI, y cuándo volvió" -- fechas siempre automáticas (now()),
-- nunca tipeadas a mano.

create table public.termos (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  numero      text not null,
  estado      text not null default 'disponible' check (estado in ('disponible', 'prestado', 'baja')),
  created_at  timestamptz not null default now(),
  unique (sucursal_id, numero)
);

create table public.prestamos_termo (
  id               uuid primary key default gen_random_uuid(),
  termo_id         uuid not null references public.termos(id) on delete restrict,
  -- Denormalizado a propósito (igual que sucursal_id en movimiento_items via movimientos
  -- no aplica acá) -- se consulta constantemente filtrado por sucursal sin pasar por termos.
  sucursal_id      uuid not null references public.sucursales(id) on delete cascade,
  dni              text not null,
  nombre           text,
  -- Referencia a la venta de la promo (yerba/hielo) que originó el préstamo,
  -- si vino del POS -- opcional porque un admin puede cargar un préstamo suelto.
  movimiento_id    uuid references public.movimientos(id) on delete set null,
  fecha_prestamo   timestamptz not null default now(),
  fecha_devolucion timestamptz,
  prestado_by      uuid references auth.users(id),
  devuelto_by      uuid references auth.users(id),
  notas            text,
  created_at       timestamptz not null default now()
);

create index prestamos_termo_termo_idx     on public.prestamos_termo (termo_id);
create index prestamos_termo_dni_idx       on public.prestamos_termo (dni);
-- Cubre tanto "termos afuera ahora mismo" (WHERE fecha_devolucion IS NULL) como
-- el listado general por sucursal.
create index prestamos_termo_sucursal_idx  on public.prestamos_termo (sucursal_id, fecha_devolucion);

-- Promos que requieren devolver un termo (ej. "Termo Mate", "Termo Mate + Chipas")
-- se marcan con este flag -- el resto de la promo (yerba, hielo, chipas) sigue
-- siendo componentes normales que se descuentan como siempre.
alter table public.promos
  add column if not exists requiere_termo boolean not null default false;

alter table public.termos          enable row level security;
alter table public.prestamos_termo enable row level security;

create policy "admin_all_termos" on public.termos for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "staff_select_termos" on public.termos for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

create policy "admin_all_prestamos_termo" on public.prestamos_termo for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "staff_select_prestamos_termo" on public.prestamos_termo for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

-- Los inserts/updates (crear termo, prestar, devolver) van siempre vía server
-- action con el cliente admin (service role) -- mismo criterio que
-- crearMovimiento/cerrar_caja: la autorización se valida en código, no con
-- policies de INSERT/UPDATE para staff.

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
begin
  -- Lockea por termo puntual -- dos alquileres simultáneos del mismo termo
  -- (ej. dos pestañas del POS) no pueden pisarse y dejarlo "prestado" dos veces.
  perform pg_advisory_xact_lock(hashtext('prestamo_termo'), hashtext(p_termo_id::text));

  select estado, sucursal_id into v_estado, v_sucursal
  from termos where id = p_termo_id;

  if v_estado is null then
    raise exception 'Termo no encontrado';
  end if;
  if v_estado <> 'disponible' then
    raise exception 'El termo no está disponible (estado actual: %)', v_estado;
  end if;

  if trim(coalesce(p_dni, '')) = '' then
    raise exception 'El DNI es obligatorio para prestar un termo';
  end if;

  update termos set estado = 'prestado' where id = p_termo_id;

  insert into prestamos_termo (termo_id, sucursal_id, dni, nombre, movimiento_id, prestado_by)
  values (p_termo_id, v_sucursal, trim(p_dni), nullif(trim(coalesce(p_nombre, '')), ''), p_movimiento_id, p_created_by)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.devolver_termo(
  p_prestamo_id uuid,
  p_devuelto_by uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_termo_id    uuid;
  v_devolucion  timestamptz;
begin
  select termo_id, fecha_devolucion into v_termo_id, v_devolucion
  from prestamos_termo where id = p_prestamo_id;

  if v_termo_id is null then
    raise exception 'Préstamo no encontrado';
  end if;
  if v_devolucion is not null then
    raise exception 'Este préstamo ya fue devuelto';
  end if;

  perform pg_advisory_xact_lock(hashtext('prestamo_termo'), hashtext(v_termo_id::text));

  update prestamos_termo
  set fecha_devolucion = now(), devuelto_by = p_devuelto_by
  where id = p_prestamo_id;

  update termos set estado = 'disponible' where id = v_termo_id;
end;
$$;

-- Mismo candado que crear_movimiento_con_items/abrir_caja/cerrar_caja (ver
-- 025_security_lockdown_rpc_and_stock_view.sql): estas RPC solo se invocan
-- desde server actions con el cliente admin (service role), que ignora
-- grants -- no hace falta (ni conviene) que "authenticated" pueda llamarlas
-- directo vía API.
revoke execute on function public.prestar_termo   from public, anon, authenticated;
revoke execute on function public.devolver_termo  from public, anon, authenticated;
