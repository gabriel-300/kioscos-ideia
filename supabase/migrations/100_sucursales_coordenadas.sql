-- Coordenadas de cada sucursal, para que /pedir ordene los locales por cercanía
-- al cliente (la distancia se calcula en el celular del cliente: acá solo se
-- guarda dónde está el local).
--
-- Solo agrega dos columnas nuevas, vacías: sin coordenadas la pantalla se
-- comporta como siempre. No toca ninguna policy ni tabla de plata.
--
-- Orden de despliegue: el código tolera que esta migración no esté aplicada
-- (lee con un respaldo sin las columnas); el formulario de coordenadas de
-- Tenteo avisa "Falta aplicar la migración 100" hasta que se aplique.

alter table public.sucursales
  add column latitud  numeric(9,6),
  add column longitud numeric(9,6);

alter table public.sucursales
  add constraint sucursales_latitud_rango  check (latitud  is null or latitud  between -90  and 90),
  add constraint sucursales_longitud_rango check (longitud is null or longitud between -180 and 180);

comment on column public.sucursales.latitud  is 'Latitud del local (grados decimales). La carga el admin en Tenteo → Configuración de pedidos.';
comment on column public.sucursales.longitud is 'Longitud del local (grados decimales). La carga el admin en Tenteo → Configuración de pedidos.';
