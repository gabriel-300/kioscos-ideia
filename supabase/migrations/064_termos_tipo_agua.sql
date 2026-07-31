-- Los termos vienen de dos tipos (agua fría / agua caliente), solo para
-- poder distinguirlos y filtrarlos en la lista -- mismas reglas de multa y
-- horas de gracia para ambos (eso sigue siendo por sucursal, no por tipo).

alter table public.termos
  add column tipo text not null default 'caliente' check (tipo in ('frio', 'caliente'));
