-- 118: punto GPS de entrega en los pedidos online con envío.
--
-- El cliente puede compartir su ubicación desde el celular en vez de (o además de) escribir la
-- dirección. El local y el repartidor la ven con un botón "Abrir en el mapa". Solo se guarda con
-- ese pedido y solo si el cliente toca el botón; los pedidos de siempre quedan en null.

alter table public.pedidos
  add column if not exists entrega_latitud  numeric(9, 6),
  add column if not exists entrega_longitud numeric(9, 6);

comment on column public.pedidos.entrega_latitud  is 'Latitud del punto de entrega compartido por el cliente (GPS); null si escribió la dirección.';
comment on column public.pedidos.entrega_longitud is 'Longitud del punto de entrega compartido por el cliente (GPS); null si escribió la dirección.';
