-- Refresca la instantánea de la base para el mapa legible.
-- Solo lee (information_schema / catálogos de Postgres). Correr en el SQL Editor de Supabase o con el MCP de solo lectura.
-- Guardar el resultado (una sola celda JSON) en scripts/mapa-base/catalog.json y luego: node scripts/mapa-base/generar.js
select jsonb_pretty(jsonb_build_object(
  'generado', current_date,
  'tablas', (
    select jsonb_agg(jsonb_build_object('t', x.t, 'k', x.k, 'cols', x.cols) order by x.t collate "C")
    from (
      select c.relname::text as t, c.relkind::text as k,
        (select string_agg(
           a.attname || ':' || format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ':NN' else '' end
             || case when a.attgenerated <> '' then ':GEN' else '' end
             || case when a.atthasdef and a.attgenerated = '' then ':DEF' else '' end,
           ' | ' order by a.attnum)
         from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as cols
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
    ) x
  ),
  'fks', (
    select jsonb_agg(jsonb_build_array(y.t, y.cols, y.ref) order by y.t collate "C", y.cols collate "C")
    from (
      select conrelid::regclass::text as t,
        (select string_agg(attname, ',') from pg_attribute where attrelid = conrelid and attnum = any(conkey)) as cols,
        confrelid::regclass::text as ref
      from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
    ) y
  )
)) as catalog;
