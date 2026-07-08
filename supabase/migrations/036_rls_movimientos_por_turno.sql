-- Auditoria 06/07, importante: "cada uno ve su turno" (batch 16, 2026-07-06)
-- solo se aplicaba en el JS de sucursales/[id]/page.tsx (enMiTurnoHoy) -- el
-- RLS real de "movimientos"/"movimiento_items" seguia dejando ver a CUALQUIER
-- encargado/vendedor de la sucursal TODOS los movimientos de HOY, sin importar
-- quien abrio el turno. Alguien con su propio JWT pegandole directo a la REST
-- API (sin pasar por la UI) veia lo mismo que antes del fix de batch 16.
--
-- Esta migracion agrega la MISMA regla a nivel RLS, replicando exactamente
-- enMiTurnoHoy(): los movimientos de dias anteriores a hoy siempre son
-- visibles (sin restriccion -- "no para atras", pedido explicito del
-- usuario); los de HOY (fecha de Argentina, no UTC) solo son visibles si
-- caen dentro de una apertura de caja que la persona que consulta abrio ELLA
-- MISMA hoy en esa sucursal. Si no abrio ningun turno hoy, no ve nada de hoy
-- (mismo comportamiento que ya tenia el JS).
--
-- admin no se toca -- sigue con su policy "admin_all_movimientos"/
-- "admin_all_movimiento_items" (FOR ALL, ve todo) sin cambios.
--
-- Nota de diseño: el calculo AUTORITATIVO del cierre de caja (total_ventas,
-- billetera/tarjeta/transferencia declarados) ya corre via service_role
-- (createAdminClient() en cierre-actions.ts), que bypasea RLS por completo --
-- esta migracion no afecta en nada esa cuenta, solo lo que ve un
-- encargado/vendedor leyendo directo con su propia sesión (el preview del
-- modal de cierre, "Ventas Hoy", Historial).

create or replace function public.movimiento_visible_por_turno(
  p_sucursal_id uuid,
  p_fecha       date,
  p_created_at  timestamptz
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Días anteriores a hoy (hora Argentina): sin restricción, historial completo.
    case when p_fecha <> (now() at time zone 'America/Argentina/Buenos_Aires')::date then true
    else exists (
      select 1
      from public.aperturas_caja a
      where a.sucursal_id = p_sucursal_id
        and a.created_by  = auth.uid()
        and a.fecha        = p_fecha
        and a.created_at  <= p_created_at
        and p_created_at  < coalesce(
              (select min(c.created_at) from public.cierres_caja c
               where c.sucursal_id = p_sucursal_id and c.created_at > a.created_at),
              'infinity'::timestamptz
            )
    )
    end;
$$;

drop policy if exists "encargado_select_movimientos" on public.movimientos;
create policy "encargado_select_movimientos" on public.movimientos for select to authenticated
  using (
    sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    and public.movimiento_visible_por_turno(sucursal_id, fecha, created_at)
  );

drop policy if exists "vendedor_select_movimientos" on public.movimientos;
create policy "vendedor_select_movimientos" on public.movimientos for select to authenticated
  using (
    sucursal_id = my_sucursal_id()
    and public.movimiento_visible_por_turno(sucursal_id, fecha, created_at)
  );

drop policy if exists "encargado_select_movimiento_items" on public.movimiento_items;
create policy "encargado_select_movimiento_items" on public.movimiento_items for select to authenticated
  using (movimiento_id in (
    select m.id from public.movimientos m where m.sucursal_id in (
      select id from public.sucursales where encargado_user_id = auth.uid()
    )
    and public.movimiento_visible_por_turno(m.sucursal_id, m.fecha, m.created_at)
  ));

drop policy if exists "vendedor_select_movimiento_items" on public.movimiento_items;
create policy "vendedor_select_movimiento_items" on public.movimiento_items for select to authenticated
  using (movimiento_id in (
    select m.id from public.movimientos m where m.sucursal_id = my_sucursal_id()
    and public.movimiento_visible_por_turno(m.sucursal_id, m.fecha, m.created_at)
  ));
