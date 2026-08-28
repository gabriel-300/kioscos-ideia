-- ============================================================
-- REPOSICIÓN AUTOMÁTICA: proveedor por producto + ciclo diario +
-- marca de "ya pedido"
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Hasta ahora /admin/reposicion armaba una lista de qué reponer, pero:
--   1. no sabía a QUÉ PROVEEDOR pedirle cada producto (el proveedor solo
--      quedaba registrado recién cuando ya se cargaba la entrega, no antes)
--   2. el ciclo de pedido fijo (dia_pedido) solo admitía UN día de la
--      semana -- productos como el pan, que se piden todos los días, no
--      tenían forma de representarse
--   3. no había manera de marcar "esto ya se pidió" -- el aviso se iba a
--      repetir todos los días hasta que llegara la entrega
-- ============================================================

-- 1. Proveedor por defecto de cada producto (para agrupar el aviso de
-- reposición por proveedor, ej. "A Petri: Pan Miñón, ..."). Es del
-- producto, no de la sucursal -- se compra al mismo proveedor en todos
-- los kioscos.
alter table public.products
  add column if not exists proveedor_id uuid references public.proveedores(id) on delete set null;

-- 2. "diario" como valor válido de dia_pedido, para productos que se
-- piden todos los días (ej. pan) en vez de un día fijo de la semana.
alter table public.products drop constraint if exists products_dia_pedido_check;
alter table public.products
  add constraint products_dia_pedido_check
  check (dia_pedido is null or dia_pedido in ('diario','lunes','martes','miercoles','jueves','viernes','sabado','domingo'));

-- Mismo gap estructural que 067/069: cualquier columna nueva en products
-- no queda visible para anon/authenticated hasta re-otorgar el grant
-- columna por columna (excluyendo costo/márgenes, que siguen solo-admin).
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
  into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name not in ('costo', 'margen_dist', 'margen_gastro', 'margen_min');

  execute 'revoke select on public.products from anon, authenticated';
  execute format('grant select (%s) on public.products to anon, authenticated', cols);
end $$;

-- 3. Marca de "ya pedido" por (producto, sucursal) -- para que el aviso de
-- hoy no repita algo que un admin ya marcó como pedido. La marca queda
-- "consumida" sola (no hay que borrarla a mano): se vuelve a mostrar el
-- ítem si aparece una entrega nueva de ese producto en esa sucursal
-- después de marcado_en -- eso lo resuelve el código que lee esta tabla,
-- comparando timestamps, no un trigger acá.
create table public.reposicion_marcas_pedido (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  marcado_en  timestamptz not null default now(),
  marcado_por uuid not null references auth.users(id),
  unique (product_id, sucursal_id)
);

alter table public.reposicion_marcas_pedido enable row level security;

create policy "admin_all_reposicion_marcas_pedido" on public.reposicion_marcas_pedido
  for all to authenticated
  using (is_admin()) with check (is_admin());
