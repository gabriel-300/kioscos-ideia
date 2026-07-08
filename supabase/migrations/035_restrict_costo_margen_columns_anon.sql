-- Auditoria 06/07: "products" expone costo/margen a `anon` -- cualquiera con la
-- anon key publica (esta en el bundle del cliente) puede pedir sin loguearse
-- GET .../rest/v1/products?select=costo,margen_dist,margen_gastro,margen_min
-- porque la tabla tiene GRANT SELECT de TODAS las columnas a anon Y a
-- authenticated (000_schema_inicial.sql), y la RLS "Todos ven productos
-- activos" solo filtra FILAS (is_active = true), nunca columnas.
--
-- Esto ademas afecta a encargado/vendedor: como Postgres no tiene un rol
-- separado por cada rol de la app (admin/encargado/vendedor son todos el
-- mismo rol Postgres "authenticated", la diferencia es un claim del JWT que
-- las policies leen), cualquiera de ellos puede pegarle directo a la REST API
-- con su propio JWT y leer costo/margen aunque la UI ya se lo oculte
-- (033_restrict_costo_a_solo_admin.sql solo restringio product_price_history,
-- no la tabla products en si).
--
-- Fix: se saca el privilegio de SELECT a nivel de TABLA completa (que domina
-- sobre cualquier revoke de columna puntual -- mismo gotcha ya documentado en
-- 029_lock_profiles_sensitive_columns.sql) y se vuelve a otorgar SELECT
-- columna por columna, excluyendo costo/margen_dist/margen_gastro/margen_min.
-- Se arma dinamicamente desde information_schema para no quedar desactualizado
-- si se agregan columnas nuevas a products en el futuro.
--
-- No se toca insert/update/delete (quedan como estaban) para no romper nada
-- de la otra app que comparte este proyecto de Supabase (ver auditoria,
-- hallazgo de "proyecto compartido"). Todo el código propio de Kioscos IDEIA
-- que necesita leer/escribir costo ya usa service_role (createAdminClient()),
-- que no se ve afectado por ningún grant/revoke de anon o authenticated.

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
