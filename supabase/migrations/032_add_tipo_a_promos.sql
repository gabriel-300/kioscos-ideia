-- Permite distinguir "promo" (combo de venta con descuento, ej. gaseosa+chips) de
-- "receta" (como se arma un producto preparado, ej. Hamburguesa Completa = pan +
-- carne + queso). Mecanicamente son lo mismo (promo_items ya descuenta stock de
-- los componentes al vender), solo cambia el proposito/etiqueta en la UI.
--
-- NOTA: ya aplicada directo contra la base el 2026-07-07 via MCP.

alter table public.promos
  add column tipo text not null default 'promo'
  constraint promos_tipo_check check (tipo in ('promo', 'receta'));
