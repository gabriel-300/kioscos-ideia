-- Restringe qué categorías de producto se venden/reciben en una sucursal --
-- caso real: Villasarita (concesión) solo va a vender "Minutas", no todo el
-- catálogo del resto de los kioscos.
--
-- null = todas las categorías (comportamiento actual, no rompe ninguna
-- sucursal existente). Array con IDs = solo esas categorías aparecen en
-- Venta Rápida, entregas, auditoría, etc. de esa sucursal.
alter table public.sucursales
  add column if not exists categorias_habilitadas uuid[];

-- Mismo caso: Villasarita no usa Pedido Ya, Cta. Corriente ni Ronda
-- comunidad -- solo cobra Consumidor Final. null = todos los canales
-- (comportamiento actual). Los valores son los mismos ids que ya usa
-- venta-rapida-form.tsx: consumidor_final, pedido_ya_efectivo,
-- pedido_ya_plataforma, cuenta_corriente, ambulante, ronda_comunidad.
alter table public.sucursales
  add column if not exists canales_habilitados text[];
