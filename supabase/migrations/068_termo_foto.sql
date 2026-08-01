-- Foto del termo para identificarlo a simple vista (útil cuando hay varios
-- termos parecidos) -- se carga al dar de alta (o después, editando) y se
-- muestra al vendedor tanto al prestarlo como al devolverlo.
alter table public.termos add column if not exists image_url text;
