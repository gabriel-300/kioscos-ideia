-- ============================================================
-- MOVIMIENTOS — Remitos de entrega a sucursales
-- Correr en Supabase → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.movimientos (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete restrict,
  fecha       date not null default current_date,
  tipo        text not null default 'entrega' check (tipo in ('entrega', 'devolucion', 'ajuste')),
  notas       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.movimiento_items (
  id              uuid primary key default gen_random_uuid(),
  movimiento_id   uuid not null references public.movimientos(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  cantidad        numeric(10,2) not null check (cantidad > 0),
  precio_unitario numeric(12,2),
  subtotal        numeric(12,2),
  created_at      timestamptz not null default now()
);

-- Índices
create index if not exists movimientos_sucursal_id_idx on public.movimientos(sucursal_id);
create index if not exists movimientos_fecha_idx       on public.movimientos(fecha desc);
create index if not exists movimiento_items_mov_idx    on public.movimiento_items(movimiento_id);

-- RLS
alter table public.movimientos      enable row level security;
alter table public.movimiento_items enable row level security;

do $$ begin
  create policy "Admins gestionan movimientos"
    on public.movimientos for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins gestionan movimiento_items"
    on public.movimiento_items for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- Grants
grant select, insert, update, delete on public.movimientos      to authenticated;
grant select, insert, update, delete on public.movimiento_items to authenticated;
