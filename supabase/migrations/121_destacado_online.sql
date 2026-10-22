-- 121: el banner grande de la tienda online (el "combo del día").
--
-- El administrador elige un producto o promo (con foto) y, si quiere, un título corto ("Combo del día").
-- La tienda lo muestra arriba, a lo grande, con un botón para pedirlo. Sin elegir nada, el banner
-- muestra lo más pedido de la sucursal. El id puede ser de un producto o de una promo (son uuid únicos).

alter table public.sucursales
  add column if not exists destacado_online_item_id uuid,
  add column if not exists destacado_online_titulo  text;

comment on column public.sucursales.destacado_online_item_id is 'Producto o promo del banner grande de la tienda online de esta sucursal; null = automático (lo más pedido).';
comment on column public.sucursales.destacado_online_titulo  is 'Título corto sobre el banner (ej. "Combo del día"); null = "Lo mejor de hoy".';
