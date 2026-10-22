-- 121: los banners grandes de la tienda online (el "combo del día").
--
-- El administrador elige hasta 3 productos o promos (con foto) y, si quiere, un título corto para cada uno
-- ("Combo del día"). La tienda los muestra arriba, a lo grande y rotando, con un botón para pedirlos. Sin
-- elegir nada, rotan los más pedidos de la sucursal.
-- Formato: [{"item_id": "<uuid de producto o promo>", "titulo": "Combo del día"}, ...]

alter table public.sucursales
  add column if not exists destacados_online jsonb not null default '[]'::jsonb;

comment on column public.sucursales.destacados_online is 'Hasta 3 banners de la tienda online: [{"item_id": uuid, "titulo": text|null}]; vacío = automático (los más pedidos).';
