-- ============================================================
-- PRECIO DE PROMOS/RECETAS POR SUCURSAL
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Mismo caso que 059_precios_por_sucursal.sql para products: el precio de
-- una promo/receta era un único valor compartido por todas las sucursales.
-- Son negocios independientes y necesitan poder cobrar distinto la misma
-- promo en cada una.
--
-- Aditiva: crea promo_prices y la llena con el precio actual de promos.price
-- como punto de partida (arrancan iguales, el admin las desacopla editando
-- cada una). promos.price deja de ser NOT NULL -- queda vestigial, como
-- products.precio_dist tras la 059.
-- ============================================================

create table if not exists public.promo_prices (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references public.promos(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  price       numeric(12,2) not null check (price >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (promo_id, sucursal_id)
);

create index if not exists promo_prices_sucursal_idx on public.promo_prices (sucursal_id);

-- Backfill: cada promo existente arranca con el mismo precio en cada
-- sucursal activa que ya tenía en la columna global.
insert into public.promo_prices (promo_id, sucursal_id, price)
select p.id, s.id, p.price
from public.promos p
cross join public.sucursales s
where s.is_active = true
on conflict (promo_id, sucursal_id) do nothing;

alter table public.promo_prices enable row level security;

do $$ begin
  create policy "Staff lee promo_prices"
    on public.promo_prices for select to authenticated
    using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins gestionan promo_prices"
    on public.promo_prices for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.promo_prices to authenticated;

alter table public.promos alter column price drop not null;
