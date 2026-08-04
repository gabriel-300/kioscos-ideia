-- ============================================================
-- PUNTOS DE STOCK POR SUCURSAL (mínimo / punto de pedido / máximo)
-- + ciclo de pedido fijo semanal (panificados)
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Hoy products.stock_minimo es un único valor global por producto (no por
-- sucursal), usado solo para el badge "Bajo Stock". Con dos sucursales de
-- volumen distinto (Parque de las Fiestas / UNAM) un solo umbral no alcanza.
-- Se agregan tres niveles por (producto, sucursal) en product_prices --
-- mismo lugar donde ya viven precio_dist/costo por el mismo motivo
-- (059_precios_por_sucursal.sql).
--
-- Todas nullable, sin default: a diferencia de precio/costo (obligatorios,
-- definen cuánto se cobra en el POS) acá no hay validación de completitud --
-- un producto sin punto_pedido configurado simplemente no genera alerta.
-- ============================================================

alter table public.product_prices
  add column if not exists punto_minimo numeric(12,2),
  add column if not exists punto_pedido numeric(12,2),
  add column if not exists punto_maximo numeric(12,2);

-- Backfill de arranque: punto_minimo hereda el stock_minimo global existente
-- (si tenía algo cargado) como piso de partida -- punto_pedido/punto_maximo
-- arrancan en null, son conceptos nuevos sin equivalente previo.
update public.product_prices pp
set punto_minimo = p.stock_minimo
from public.products p
where pp.product_id = p.id
  and p.stock_minimo > 0
  and pp.punto_minimo is null;

-- ── Ciclo de pedido fijo (panadería y similares) ──
-- Algunos productos se piden un día fijo de la semana y tardan varios días
-- en llegar (ej. "se pide alfajor de maicena hoy, lo producen mañana, entrega
-- pasado mañana"). Es del producto/proveedor, no cambia entre sucursales --
-- por eso va en products, no en product_prices.
alter table public.products
  add column if not exists dias_entrega integer,
  add column if not exists dia_pedido   text;

do $$ begin
  alter table public.products
    add constraint products_dia_pedido_check
    check (dia_pedido is null or dia_pedido in ('lunes','martes','miercoles','jueves','viernes','sabado','domingo'));
exception when duplicate_object then null; end $$;

-- Mismo gap estructural que 067_fix_products_column_grants.sql: cualquier
-- columna nueva en products NO queda con SELECT otorgado a anon/authenticated
-- (grant column-by-column dinámico desde 035_restrict_costo_margen_columns_
-- anon.sql, excluyendo costo/margen_*) -- sin este re-grant, dias_entrega/
-- dia_pedido serían invisibles para el cliente de sesión (no admin).
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
