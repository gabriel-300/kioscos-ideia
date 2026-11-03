-- Copia los precios de venta de Angiru Food Costanera a Paseo Bencivenga (local independiente),
-- para que no tenga que cargar producto por producto: los productos y promos de IDEIA (catálogo
-- global) pasan a tener precio en su sucursal y por eso aparecen en la venta, en Stock y en Precios.
--
-- - Solo productos/promos ACTIVOS, GLOBALES (owner_sucursal_id null) y con precio > 0 en Costanera.
-- - El COSTO queda en 0 a propósito: el costo de IDEIA no se le pasa a un local independiente; el
--   dueño carga el suyo en Sucursales → Precios.
-- - No pisa nada: lo que Bencivenga ya tenga cargado se conserva.
-- - Se puede correr más de una vez.
--
-- Correr a mano en el SQL Editor de Supabase.

begin;

insert into product_prices (product_id, sucursal_id, precio_dist, costo)
select pp.product_id, '30f3aa45-5576-431e-8fbc-edc017b50291', pp.precio_dist, 0
from product_prices pp
join products p on p.id = pp.product_id
where pp.sucursal_id = 'd120dc6f-9754-46d0-94d0-a1fd5b05aa74'
  and p.is_active
  and p.owner_sucursal_id is null
  and pp.precio_dist > 0
  and not exists (
    select 1 from product_prices x
    where x.product_id = pp.product_id and x.sucursal_id = '30f3aa45-5576-431e-8fbc-edc017b50291'
  );

insert into promo_prices (promo_id, sucursal_id, price)
select pr.promo_id, '30f3aa45-5576-431e-8fbc-edc017b50291', pr.price
from promo_prices pr
join promos p on p.id = pr.promo_id
where pr.sucursal_id = 'd120dc6f-9754-46d0-94d0-a1fd5b05aa74'
  and p.is_active
  and p.owner_sucursal_id is null
  and pr.price > 0
  and not exists (
    select 1 from promo_prices x
    where x.promo_id = pr.promo_id and x.sucursal_id = '30f3aa45-5576-431e-8fbc-edc017b50291'
  );

-- Control: cuántos precios tiene ahora Bencivenga.
select
  (select count(*) from product_prices where sucursal_id = '30f3aa45-5576-431e-8fbc-edc017b50291') as productos_con_precio,
  (select count(*) from promo_prices   where sucursal_id = '30f3aa45-5576-431e-8fbc-edc017b50291') as promos_con_precio;

commit;
