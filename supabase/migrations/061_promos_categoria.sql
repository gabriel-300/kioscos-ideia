-- Las promociones/recetas no tenian categoria -- vivian todas juntas en una
-- pestaña aparte "Promos" del POS, separadas de las categorias de productos.
-- Esto es un problema real cuando una receta reemplaza a un producto que SI
-- tenia categoria (ej. "Pizza 4 Quesas MM Horno" pasa de producto con stock
-- propio a receta que consume el stock de "Pizza Congelada MM 4 quesos") --
-- el vendedor la busca en la pestaña de su categoria (MINUTAS), no en una
-- bolsa generica de promos.

alter table public.promos
  add column if not exists category_id uuid references public.categories(id) on delete set null;
