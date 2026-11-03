-- Carga DESDE CERO el catálogo de Paseo Bencivenga (local independiente) a partir de Angiru Food Costanera.
-- Crea COPIAS PROPIAS (con dueño = Bencivenga) de categorías, productos y promos/recetas, para que el
-- dueño las vea en Productos / Categorías / Promociones y las pueda editar sin tocar el catálogo de IDEIA.
--
-- Qué copia (solo lo ACTIVO de Costanera, del catálogo global, con precio > 0 allá):
--   - categorías que usan esos productos y promos
--   - productos: nombre, descripción, unidad, imagen, etc.  SKU nuevo = 'BEN-' + SKU de IDEIA
--   - promos/recetas con sus componentes; se saltea la que use un producto que no se copia
--   - precio de venta de cada producto/promo en Bencivenga
-- Qué NO copia, a propósito:
--   - el COSTO (queda en 0): el costo de IDEIA no se le pasa a un local independiente; el dueño carga el suyo
--   - proveedores, stock, puntos de pedido
--
-- Antes de copiar BORRA los 2 precios de productos de IDEIA que Bencivenga tenía cargados a mano
-- (Bencivenga no tiene movimientos todavía, así que no se pierde nada).
-- Se corre UNA sola vez: si Bencivenga ya tiene productos propios, aborta sin tocar nada.
--
-- Correr a mano en el SQL Editor de Supabase.

begin;

do $$
declare
  suc  constant uuid := '30f3aa45-5576-431e-8fbc-edc017b50291'; -- Paseo Bencivenga
  orig constant uuid := 'd120dc6f-9754-46d0-94d0-a1fd5b05aa74'; -- Angiru Food Costanera
  suf  constant text := left(suc::text, 6);
begin
  if not exists (select 1 from sucursales where id = suc and catalogo_propio) then
    raise exception 'Paseo Bencivenga no tiene tildado "catálogo propio".';
  end if;
  if exists (select 1 from products where owner_sucursal_id = suc)
     or exists (select 1 from categories where owner_sucursal_id = suc)
     or exists (select 1 from promos where owner_sucursal_id = suc) then
    raise exception 'Bencivenga ya tiene catálogo propio cargado; este script es para correr una sola vez.';
  end if;
  if exists (select 1 from movimientos where sucursal_id = suc) then
    raise exception 'Bencivenga ya tiene movimientos; no se puede cargar de cero.';
  end if;

  -- 1) De cero: fuera los precios sueltos de productos/promos de IDEIA.
  delete from product_prices where sucursal_id = suc;
  delete from promo_prices   where sucursal_id = suc;

  -- 2) Productos de origen (activos, globales, con precio en Costanera).
  create temp table t_prod on commit drop as
    select p.id as old_id, gen_random_uuid() as new_id, pp.precio_dist
    from products p
    join product_prices pp on pp.product_id = p.id and pp.sucursal_id = orig
    where p.is_active and p.owner_sucursal_id is null and pp.precio_dist > 0;

  -- 3) Categorías usadas por esos productos y por las promos que se copian.
  create temp table t_promo on commit drop as
    select pr.id as old_id, gen_random_uuid() as new_id, x.price
    from promos pr
    join promo_prices x on x.promo_id = pr.id and x.sucursal_id = orig
    where pr.is_active and pr.owner_sucursal_id is null and x.price > 0
      and not exists (
        select 1 from promo_items i
        where i.promo_id = pr.id and i.product_id not in (select old_id from t_prod)
      );

  create temp table t_cat on commit drop as
    select c.id as old_id, gen_random_uuid() as new_id
    from categories c
    where c.owner_sucursal_id is null
      and (c.id in (select p.category_id from products p join t_prod t on t.old_id = p.id)
        or c.id in (select pr.category_id from promos pr join t_promo t on t.old_id = pr.id));

  insert into categories (id, slug, name, description, image_url, sort_order, is_active, owner_sucursal_id)
  select t.new_id, c.slug || '-' || suf, c.name, c.description, c.image_url, c.sort_order, true, suc
  from categories c join t_cat t on t.old_id = c.id;

  insert into products (id, sku, slug, name, short_description, description, category_id, unit_label,
                        weight_grams, freezer_required, is_active, cover_image_url, gallery_urls, metadata,
                        merma_coccion_pct, vendible_pos, owner_sucursal_id)
  select t.new_id, 'BEN-' || p.sku, p.slug || '-' || suf, p.name, p.short_description, p.description,
         (select tc.new_id from t_cat tc where tc.old_id = p.category_id),
         p.unit_label, p.weight_grams, p.freezer_required, true, p.cover_image_url, p.gallery_urls, p.metadata,
         p.merma_coccion_pct, p.vendible_pos, suc
  from products p join t_prod t on t.old_id = p.id;

  insert into product_prices (product_id, sucursal_id, precio_dist, costo)
  select new_id, suc, precio_dist, 0 from t_prod;

  insert into promos (id, name, price, is_active, tipo, cover_image_url, category_id, requiere_termo, owner_sucursal_id)
  select t.new_id, pr.name, t.price, true, pr.tipo, pr.cover_image_url,
         (select tc.new_id from t_cat tc where tc.old_id = pr.category_id),
         pr.requiere_termo, suc
  from promos pr join t_promo t on t.old_id = pr.id;

  insert into promo_items (promo_id, product_id, cantidad)
  select tp.new_id, tq.new_id, i.cantidad
  from promo_items i
  join t_promo tp on tp.old_id = i.promo_id
  join t_prod  tq on tq.old_id = i.product_id;

  insert into promo_prices (promo_id, sucursal_id, price)
  select new_id, suc, price from t_promo;
end $$;

-- Control: qué quedó cargado en Bencivenga.
select
  (select count(*) from categories where owner_sucursal_id = '30f3aa45-5576-431e-8fbc-edc017b50291') as categorias,
  (select count(*) from products   where owner_sucursal_id = '30f3aa45-5576-431e-8fbc-edc017b50291') as productos,
  (select count(*) from product_prices where sucursal_id  = '30f3aa45-5576-431e-8fbc-edc017b50291') as precios_producto,
  (select count(*) from promos     where owner_sucursal_id = '30f3aa45-5576-431e-8fbc-edc017b50291') as promos,
  (select count(*) from promo_prices where sucursal_id    = '30f3aa45-5576-431e-8fbc-edc017b50291') as precios_promo;

commit;
