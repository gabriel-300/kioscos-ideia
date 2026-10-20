-- 119: elegir qué productos y promos se ofrecen en los pedidos online de cada sucursal.
--
-- Hoy la tienda y el bot ofrecen todo lo que tiene stock en el local. Con estas dos listas el
-- administrador puede esconder productos o promos puntuales (por ejemplo, no mandar churros por
-- delivery) sin tocar el kiosco: solo afecta a lo que ve el cliente online. Vacías = se ofrece todo
-- lo que tenga stock, como hasta ahora.

alter table public.sucursales
  add column if not exists productos_ocultos_online uuid[] not null default '{}',
  add column if not exists promos_ocultas_online    uuid[] not null default '{}';

comment on column public.sucursales.productos_ocultos_online is 'Productos que NO se ofrecen en pedidos online de esta sucursal (la caja del kiosco no se entera).';
comment on column public.sucursales.promos_ocultas_online    is 'Promos y recetas que NO se ofrecen en pedidos online de esta sucursal.';
