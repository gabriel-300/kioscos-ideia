-- ============================================================================
-- 131 · Catálogo con dueño (negocio independiente dentro del mismo sistema)
--
-- Caso: un local nuevo, de otra persona, usa el sistema completo del kiosco pero
-- con su propio catálogo (productos, categorías, promos/recetas) y sus propios
-- costos, sin ver ni mezclarse con lo de los demás kioscos. Convive con el
-- catálogo global de IDEIA (los productos que son los mismos que los nuestros).
--
-- Regla: owner_sucursal_id NULL = catálogo global (IDEIA, como hasta hoy).
--        owner_sucursal_id = X  = pertenece a la sucursal X: solo lo ven y editan
--        el admin y las personas de esa sucursal.
--
-- Qué NO cambia: la venta ya exige una fila en product_prices para la sucursal
-- (movimientos/actions.ts), así que un producto propio -- que solo tiene precio
-- en su sucursal -- no se puede vender en las demás aunque alguien lo viera.
-- Las escrituras siguen yendo por Server Actions con el cliente admin (las
-- policies de escritura siguen siendo solo admin).
--
-- Aditiva y sin riesgo para lo existente: todas las filas actuales quedan en NULL.
-- ============================================================================

alter table public.products   add column if not exists owner_sucursal_id uuid references public.sucursales(id) on delete restrict;
alter table public.categories add column if not exists owner_sucursal_id uuid references public.sucursales(id) on delete restrict;
alter table public.promos     add column if not exists owner_sucursal_id uuid references public.sucursales(id) on delete restrict;

-- Interruptor por sucursal: solo un concesionario cuya sucursal tenga
-- catalogo_propio = true puede cargar productos, categorías y promos. Villa Sarita
-- (consignación, usa el catálogo de IDEIA) queda en false: su rol no cambia.
alter table public.sucursales add column if not exists catalogo_propio boolean not null default false;

create index if not exists products_owner_idx  on public.products   (owner_sucursal_id) where owner_sucursal_id is not null;
create index if not exists categories_owner_idx on public.categories (owner_sucursal_id) where owner_sucursal_id is not null;
create index if not exists promos_owner_idx     on public.promos     (owner_sucursal_id) where owner_sucursal_id is not null;

-- ¿Puede la persona logueada ver una fila de este dueño? Global, admin, o
-- alguien de esa sucursal (encargado/concesionario por encargado_user_id,
-- vendedor por profile_sucursales). security definer para no depender de la RLS
-- de sucursales/profile_sucursales dentro de la policy.
create or replace function public.puede_ver_dueno(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_owner is null
      or is_admin()
      or exists (select 1 from public.sucursales s where s.id = p_owner and s.encargado_user_id = auth.uid())
      or exists (select 1 from public.profile_sucursales ps where ps.sucursal_id = p_owner and ps.profile_id = auth.uid());
$$;

revoke all on function public.puede_ver_dueno(uuid) from public;
grant execute on function public.puede_ver_dueno(uuid) to authenticated;

-- ── Lecturas ────────────────────────────────────────────────────────────────
-- anon (tienda pública): solo el catálogo global. Los productos de un negocio
-- independiente se publican por su propia vía, no por la tienda de IDEIA.
drop policy if exists "Todos ven productos activos" on public.products;
drop policy if exists products_select_anon on public.products;
create policy products_select_anon on public.products
  for select to anon
  using (is_active = true and owner_sucursal_id is null);

drop policy if exists products_select_auth on public.products;
create policy products_select_auth on public.products
  for select to authenticated
  using (((is_active = true) or (select is_admin())) and (select puede_ver_dueno(owner_sucursal_id)));

drop policy if exists "Todos ven categorías activas" on public.categories;
drop policy if exists categories_select_anon on public.categories;
create policy categories_select_anon on public.categories
  for select to anon
  using (is_active = true and owner_sucursal_id is null);

drop policy if exists categories_select_auth on public.categories;
create policy categories_select_auth on public.categories
  for select to authenticated
  using (((is_active = true) or (select is_admin())) and (select puede_ver_dueno(owner_sucursal_id)));

drop policy if exists "Staff lee promos" on public.promos;
create policy "Staff lee promos" on public.promos
  for select to authenticated
  using ((select puede_ver_dueno(owner_sucursal_id)));

-- Los ítems de una promo/receta se ven solo si se ve la promo (la RLS de promos
-- se aplica dentro del exists).
drop policy if exists "Staff lee promo_items" on public.promo_items;
create policy "Staff lee promo_items" on public.promo_items
  for select to authenticated
  using (exists (select 1 from public.promos p where p.id = promo_items.promo_id));
