-- 035_restrict_costo_margen_columns_anon.sql revocó el SELECT de tabla
-- completa en products y volvió a otorgar columna por columna (para poder
-- excluir costo/margen_*), calculando la lista desde information_schema en
-- el momento en que se corrió esa migración (06/07). El problema: es una
-- foto fija -- cualquier columna agregada a products DESPUÉS de esa fecha
-- (weight_grams, vendible_pos, cover_image_url, merma_coccion_pct,
-- created_by, updated_by, etc. -- son muchas ya) nunca quedó con SELECT
-- otorgado a anon/authenticated. Un `select("*")` con el cliente de sesión
-- (no admin/service_role) contra products falla en silencio por falta de
-- privilegio de columna, y en el dashboard eso se traducía en "0 productos
-- activos de 0 totales" porque el código no chequeaba el error.
--
-- Fix: mismo mecanismo dinámico de 035, recalculado con las columnas
-- ACTUALES. Sigue excluyendo costo/margen_dist/margen_gastro/margen_min
-- (motivo original de 035 -- no cambia). Nota para el futuro: este gap va a
-- volver a aparecer cada vez que se agregue una columna nueva a products, es
-- un problema estructural del enfoque columna-por-columna, no algo que esta
-- migración resuelva de forma permanente.

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
  into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name not in ('costo', 'margen_dist', 'margen_gastro', 'margen_min');

  execute 'revoke select on public.products from anon, authenticated';
  execute format('grant select (%s) on public.products to anon, authenticated', cols);
end $$;
