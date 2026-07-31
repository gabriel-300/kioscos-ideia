-- Transferencia de stock entre sucursales, con confirmación de recepción:
-- el stock sale de la sucursal origen al enviar (físicamente ya se fue),
-- pero no entra a la sucursal destino hasta que alguien ahí confirma que
-- llegó -- evita stock fantasma si algo se pierde o tarda en el camino.
-- Mismo criterio que auditorias_stock: alguien reporta, otra persona
-- confirma/materializa, con guard contra doble-confirmación.

alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo = any (array['entrega','devolucion','ajuste','venta','merma','transferencia_salida','transferencia_entrada']));

create table public.transferencias_stock (
  id                    uuid primary key default gen_random_uuid(),
  sucursal_origen_id    uuid not null references public.sucursales(id) on delete restrict,
  sucursal_destino_id   uuid not null references public.sucursales(id) on delete restrict,
  fecha                 date not null,
  estado                text not null default 'enviada' check (estado in ('enviada','recibida')),
  notas_envio           text,
  notas_recepcion       text,
  movimiento_salida_id  uuid references public.movimientos(id) on delete set null,
  movimiento_entrada_id uuid references public.movimientos(id) on delete set null,
  enviado_por           uuid references auth.users(id),
  recibido_por          uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  confirmado_en         timestamptz,
  check (sucursal_origen_id <> sucursal_destino_id)
);

create table public.transferencia_items (
  id                uuid primary key default gen_random_uuid(),
  transferencia_id  uuid not null references public.transferencias_stock(id) on delete cascade,
  product_id        uuid not null references public.products(id),
  cantidad_enviada  numeric not null check (cantidad_enviada > 0),
  cantidad_recibida numeric,
  created_at        timestamptz not null default now()
);

create index transferencias_stock_origen_idx  on public.transferencias_stock (sucursal_origen_id);
create index transferencias_stock_destino_idx on public.transferencias_stock (sucursal_destino_id);
create index transferencias_stock_estado_idx  on public.transferencias_stock (estado);
create index transferencia_items_transferencia_idx on public.transferencia_items (transferencia_id);

alter table public.transferencias_stock enable row level security;
alter table public.transferencia_items   enable row level security;

create policy "admin_all_transferencias_stock" on public.transferencias_stock
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "staff_select_transferencias_stock" on public.transferencias_stock
  for select to authenticated
  using (
    is_admin()
    or sucursal_origen_id  in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_destino_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_origen_id  = my_sucursal_id()
    or sucursal_destino_id = my_sucursal_id()
  );

create policy "admin_all_transferencia_items" on public.transferencia_items
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "staff_select_transferencia_items" on public.transferencia_items
  for select to authenticated
  using (
    is_admin()
    or transferencia_id in (
      select id from public.transferencias_stock t
      where t.sucursal_origen_id  in (select id from public.sucursales where encargado_user_id = auth.uid())
         or t.sucursal_destino_id in (select id from public.sucursales where encargado_user_id = auth.uid())
         or t.sucursal_origen_id  = my_sucursal_id()
         or t.sucursal_destino_id = my_sucursal_id()
    )
  );

-- Los inserts/updates (enviar, confirmar) van siempre vía server action con
-- el cliente admin (service role) -- mismo criterio que crearMovimiento/
-- cerrar_caja/auditoria: la autorización se valida en código, no con
-- policies de INSERT/UPDATE para staff.

-- ── stock_sucursal (vigente desde 063_anular_venta.sql) ────────────────────
-- Se agregan los dos tipos nuevos: transferencia_entrada suma como entrega,
-- transferencia_salida resta como devolucion/venta/merma.
create or replace view public.stock_sucursal
with (security_invoker = on)
as
 select m.sucursal_id,
    mi.product_id,
    p.name as product_name,
    p.sku,
    sum(
        case
            when m.anulado_en is not null then 0
            when m.tipo = any (array['entrega', 'transferencia_entrada']) then mi.cantidad
            when m.tipo = 'ajuste' and mi.cantidad > 0 then mi.cantidad
            else 0
        end) as entradas,
    sum(
        case
            when m.anulado_en is not null then 0
            when m.tipo = any (array['devolucion', 'venta', 'merma', 'transferencia_salida']) then mi.cantidad
            when m.tipo = 'ajuste' and mi.cantidad < 0 then abs(mi.cantidad)
            else 0
        end) as salidas,
    sum(
        case
            when m.anulado_en is not null then 0
            when m.tipo = any (array['entrega', 'transferencia_entrada']) then mi.cantidad
            when m.tipo = 'ajuste' then mi.cantidad
            when m.tipo = any (array['devolucion', 'venta', 'merma', 'transferencia_salida']) then -mi.cantidad
            else 0
        end) as stock_actual
   from movimiento_items mi
     join movimientos m on m.id = mi.movimiento_id
     join products p on p.id = mi.product_id
  group by m.sucursal_id, mi.product_id, p.name, p.sku;

grant select on public.stock_sucursal to authenticated;

-- ── enviar_transferencia_stock ──────────────────────────────────────────
create or replace function public.enviar_transferencia_stock(
  p_sucursal_origen_id  uuid,
  p_sucursal_destino_id uuid,
  p_fecha               date,
  p_notas               text default null,
  p_created_by          uuid default null,
  p_items               jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_transferencia_id uuid;
  v_movimiento_id    uuid;
  v_item             jsonb;
  v_product_id       uuid;
  v_cantidad         numeric;
  v_destino_nombre   text;
begin
  if p_sucursal_origen_id = p_sucursal_destino_id then
    raise exception 'La sucursal de origen y destino no pueden ser la misma';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia necesita al menos un producto';
  end if;

  select nombre into v_destino_nombre from sucursales where id = p_sucursal_destino_id;
  if v_destino_nombre is null then
    raise exception 'Sucursal destino no encontrada';
  end if;

  insert into transferencias_stock (sucursal_origen_id, sucursal_destino_id, fecha, notas_envio, enviado_por)
  values (p_sucursal_origen_id, p_sucursal_destino_id, p_fecha, p_notas, p_created_by)
  returning id into v_transferencia_id;

  insert into movimientos (sucursal_id, fecha, tipo, notas, created_by)
  values (p_sucursal_origen_id, p_fecha, 'transferencia_salida', 'Transferencia a ' || v_destino_nombre, p_created_by)
  returning id into v_movimiento_id;

  update transferencias_stock set movimiento_salida_id = v_movimiento_id where id = v_transferencia_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_cantidad   := (v_item->>'cantidad')::numeric;

    if v_cantidad <= 0 then
      raise exception 'La cantidad debe ser mayor a 0';
    end if;

    perform pg_advisory_xact_lock(hashtext(p_sucursal_origen_id::text), hashtext(v_product_id::text));

    insert into movimiento_items (movimiento_id, product_id, cantidad)
    values (v_movimiento_id, v_product_id, v_cantidad);

    insert into transferencia_items (transferencia_id, product_id, cantidad_enviada)
    values (v_transferencia_id, v_product_id, v_cantidad);
  end loop;

  return v_transferencia_id;
end;
$$;

revoke execute on function public.enviar_transferencia_stock(uuid, uuid, date, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enviar_transferencia_stock(uuid, uuid, date, text, uuid, jsonb) to service_role, postgres;

-- ── confirmar_transferencia_stock ────────────────────────────────────────
create or replace function public.confirmar_transferencia_stock(
  p_transferencia_id uuid,
  p_fecha            date,
  p_recibido_por     uuid default null,
  p_notas_recepcion  text default null,
  p_items            jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sucursal_destino_id uuid;
  v_estado              text;
  v_movimiento_id        uuid;
  v_item                 jsonb;
  v_ti_id                 uuid;
  v_cantidad              numeric;
  v_product_id            uuid;
begin
  select sucursal_destino_id, estado into v_sucursal_destino_id, v_estado
  from transferencias_stock where id = p_transferencia_id;

  if v_sucursal_destino_id is null then
    raise exception 'Transferencia no encontrada';
  end if;
  if v_estado = 'recibida' then
    raise exception 'Esta transferencia ya fue confirmada';
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

revoke execute on function public.confirmar_transferencia_stock(uuid, date, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirmar_transferencia_stock(uuid, date, uuid, text, jsonb) to service_role, postgres;
