-- Productos que son insumo (ej. salchicha, pan de pancho) no deberian
-- aparecer como tile vendible en el POS, pero si tienen que seguir contando
-- stock y quedar disponibles para armar recetas/promos. vendible_pos=true
-- (default) para no ocultar nada del catalogo existente sin que el usuario
-- lo decida a mano desde el formulario de producto.
alter table public.products
  add column vendible_pos boolean not null default true;
