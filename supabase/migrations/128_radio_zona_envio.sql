-- 128: hasta dónde llega cada zona de envío.
--
-- radio_km: distancia máxima, en línea recta, entre el local y el punto GPS al que se pide el envío. Si la
-- ubicación del cliente cae más lejos, el servidor rechaza el pedido y la tienda se lo avisa antes de pagar
-- ("esa ubicación está a 12 km del local y la zona llega hasta 1,5 km"). null = sin límite (como hasta ahora).
-- Se carga por zona desde Tenteo → Configuración → Zonas de envío; el local necesita tener sus coordenadas
-- cargadas (sucursales.latitud / longitud) para que se pueda medir.

alter table public.zonas_entrega
  add column if not exists radio_km numeric(5,2) check (radio_km is null or radio_km > 0);
