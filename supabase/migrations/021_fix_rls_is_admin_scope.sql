-- ============================================================
-- FIX RLS: is_admin() incluía indebidamente 'encargado', lo que
-- permitía a cualquier encargado leer/editar movimientos, movimiento_items,
-- sucursales, products, categories, promos y platform_settings de
-- CUALQUIER kiosco (no solo el propio) vía la API directa de Supabase.
-- Corrección: is_admin() vuelve a ser estrictamente admin, y se agregan
-- policies scopeadas por sucursal para encargado/vendedor donde hacía falta.
-- Aplicada en producción vía Management API el 2026-07-03.
-- ============================================================

create or replace function my_sucursal_id()
returns uuid
language sql
stable security definer
set search_path = ''
as $$
  select sucursal_id from public.profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- movimientos: encargado/vendedor solo ven los de su propia sucursal
drop policy if exists "Admins gestionan movimientos" on public.movimientos;
create policy "admin_all_movimientos" on public.movimientos for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "encargado_select_movimientos" on public.movimientos for select to authenticated
  using (sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()));
create policy "vendedor_select_movimientos" on public.movimientos for select to authenticated
  using (sucursal_id = my_sucursal_id());

-- movimiento_items: mismo scoping, vía el movimiento padre
drop policy if exists "Admins gestionan movimiento_items" on public.movimiento_items;
create policy "admin_all_movimiento_items" on public.movimiento_items for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "encargado_select_movimiento_items" on public.movimiento_items for select to authenticated
  using (movimiento_id in (
    select id from public.movimientos where sucursal_id in (
      select id from public.sucursales where encargado_user_id = auth.uid()
    )
  ));
create policy "vendedor_select_movimiento_items" on public.movimiento_items for select to authenticated
  using (movimiento_id in (
    select id from public.movimientos where sucursal_id = my_sucursal_id()
  ));

-- cta_corriente_pagos: scopear por sucursal (antes era global para cualquier encargado/vendedor)
drop policy if exists "ctc_pagos_select" on public.cta_corriente_pagos;
drop policy if exists "ctc_pagos_write" on public.cta_corriente_pagos;
create policy "ctc_pagos_select" on public.cta_corriente_pagos for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );
create policy "ctc_pagos_write" on public.cta_corriente_pagos for all to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
  )
  with check (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
  );

-- profiles: encargado/vendedor necesitan ver los perfiles de su propia sucursal
-- (usado en Cta. Corriente para listar personal) — antes lo daba is_admin() de rebote.
create policy "encargado_view_sucursal_profiles" on public.profiles for select to authenticated
  using (sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()));
create policy "vendedor_view_sucursal_profiles" on public.profiles for select to authenticated
  using (sucursal_id = my_sucursal_id());
