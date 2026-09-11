-- Apaga promociones enteras para una sucursal, sin depender de que cada
-- promo tenga (o no tenga) categoría asignada -- caso real: Villasarita no
-- quiere ninguna promoción, ni aunque en el futuro se cree una etiquetada
-- "Minutas". true = comportamiento de siempre (se ven las que matcheen
-- categoría, como ya filtra la migración 088).
alter table public.sucursales
  add column if not exists promos_habilitadas boolean not null default true;
