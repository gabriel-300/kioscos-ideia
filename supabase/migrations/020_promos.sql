-- ============================================================
-- PROMOS — Combos de venta (descuentan stock de sus componentes)
-- Correr en Supabase → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.promos (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  price      numeric(12,2) not null check (price >= 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promo_items (
  id         uuid primary key default gen_random_uuid(),
  promo_id   uuid not null references public.promos(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  cantidad   numeric(10,2) not null check (cantidad > 0),
  created_at timestamptz not null default now()
);

alter table public.movimiento_items
  add column if not exists promo_id uuid references public.promos(id) on delete set null;

create index if not exists promo_items_promo_id_idx   on public.promo_items(promo_id);
create index if not exists movimiento_items_promo_idx on public.movimiento_items(promo_id);

-- RLS
alter table public.promos      enable row level security;
alter table public.promo_items enable row level security;

do $$ begin
  create policy "Admins gestionan promos"
    on public.promos for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff lee promos"
    on public.promos for select to authenticated
    using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins gestionan promo_items"
    on public.promo_items for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff lee promo_items"
    on public.promo_items for select to authenticated
    using (true);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.promos      to authenticated;
grant select, insert, update, delete on public.promo_items to authenticated;

-- Actualizar función para aceptar promo_id opcional en cada item
create or replace function crear_movimiento_con_items(
  p_sucursal_id        uuid,
  p_fecha              date,
  p_tipo               text,
  p_notas              text    default null,
  p_proveedor          text    default null,
  p_nro_remito         text    default null,
  p_canal              text    default 'consumidor_final',
  p_personal_id        uuid    default null,
  p_pago_efectivo      numeric default null,
  p_pago_billetera     numeric default null,
  p_pago_tarjeta       numeric default null,
  p_pago_transferencia numeric default null,
  p_created_by         uuid    default null,
  p_items              jsonb   default '[]'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_movimiento_id uuid;
  v_item          jsonb;
begin
  insert into movimientos (
    sucursal_id, fecha, tipo, notas, proveedor, nro_remito,
    canal, personal_id,
    pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia,
    created_by
  ) values (
    p_sucursal_id, p_fecha, p_tipo, p_notas, p_proveedor, p_nro_remito,
    p_canal, p_personal_id,
    p_pago_efectivo, p_pago_billetera, p_pago_tarjeta, p_pago_transferencia,
    p_created_by
  )
  returning id into v_movimiento_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into movimiento_items (movimiento_id, product_id, cantidad, precio_unitario, subtotal, promo_id)
    values (
      v_movimiento_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'cantidad')::numeric,
      nullif(v_item->>'precio_unitario', 'null')::numeric,
      nullif(v_item->>'subtotal',        'null')::numeric,
      nullif(v_item->>'promo_id',        'null')::uuid
    );
  end loop;

  return v_movimiento_id;
end;
$$;
