-- ============================================================
-- PRECIOS Y COSTO POR SUCURSAL
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Hoy products.precio_dist / products.costo son un único valor por
-- producto, compartido por las dos sucursales. Son negocios independientes
-- y necesitan poder tener precio y costo distintos.
--
-- Esta migración es puramente ADITIVA: crea la tabla nueva y la llena con
-- el valor actual de products como punto de partida (arrancan iguales, el
-- admin las desacopla editando cada una). NO borra products.precio_dist ni
-- products.costo -- eso queda para una migración de limpieza posterior, una
-- vez que el código nuevo esté deployado y confirmado funcionando (las
-- migraciones acá se aplican a mano, no atómicamente con el deploy de
-- GitHub Actions, así que sacar las columnas viejas en el mismo paso sería
-- arriesgado si algo del código todavía las lee).
-- ============================================================

create table if not exists public.product_prices (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  precio_dist numeric(12,2) not null,
  costo       numeric(12,2) not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (product_id, sucursal_id)
);

create index if not exists product_prices_sucursal_idx on public.product_prices (sucursal_id);

-- Backfill: cada producto existente arranca con el mismo precio/costo en
-- cada sucursal activa que ya tenía en la columna global.
insert into public.product_prices (product_id, sucursal_id, precio_dist, costo)
select p.id, s.id, coalesce(p.precio_dist, 0), coalesce(p.costo, 0)
from public.products p
cross join public.sucursales s
where s.is_active = true
on conflict (product_id, sucursal_id) do nothing;

alter table public.product_prices enable row level security;

-- Mismo criterio que products: precio_dist lo necesita ver cualquier
-- personal autenticado (lo usan en el POS), costo es información sensible
-- que solo debería ver admin -- se resuelve con el mismo mecanismo de grant
-- column-level dinámico que 035_restrict_costo_margen_columns_anon.sql usó
-- para products (revoke a nivel tabla + grant columna por columna).
do $$ begin
  create policy "Staff lee product_prices"
    on public.product_prices for select to authenticated
    using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins gestionan product_prices"
    on public.product_prices for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.product_prices to authenticated;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
  into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'product_prices'
    and column_name not in ('costo');

  execute 'revoke select on public.product_prices from authenticated';
  execute format('grant select (%s) on public.product_prices to authenticated', cols);
end $$;

-- ── product_price_history ───────────────────────────────────
-- Esta tabla se creó directo contra la base (no está en ninguna migración
-- versionada, ver 033_restrict_costo_a_solo_admin.sql que ya asume que
-- existe) -- se versiona acá con su forma actual conocida, más la columna
-- nueva sucursal_id. Las filas históricas anteriores a este cambio quedan
-- con sucursal_id = null (no hay forma de reconstruir a qué sucursal
-- correspondía un cambio de precio global viejo).
create table if not exists public.product_price_history (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products(id) on delete cascade,
  precio_dist_anterior  numeric(12,2),
  precio_dist_nuevo     numeric(12,2),
  costo_anterior        numeric(12,2),
  costo_nuevo           numeric(12,2),
  changed_by            uuid references auth.users(id),
  changed_at            timestamptz not null default now()
);

alter table public.product_price_history
  add column if not exists sucursal_id uuid references public.sucursales(id) on delete set null;

create index if not exists product_price_history_sucursal_idx on public.product_price_history (sucursal_id);
