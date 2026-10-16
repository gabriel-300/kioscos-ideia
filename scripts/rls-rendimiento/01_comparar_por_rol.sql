-- 01_comparar_por_rol.sql
--
-- Compara, con RLS REAL, qué ve y qué puede escribir cada rol. Se corre en el SQL Editor
-- de Supabase (como postgres) ANTES de aplicar la migración 098 y DESPUES. Las dos
-- salidas deben ser idénticas (columna "huella" igual en cada fila).
--
-- Qué hace, por cada usuario real de auth.users (los 5 roles) + anónimo + dos simulados
-- (repartidor y "sin rol"), y por cada tabla con policies de public:
--   S  cuenta y hashea las filas que el usuario ve (SELECT con RLS real).
--   U  prueba un UPDATE (id = id) sobre una muestra fija de filas y cuenta cuántas pasan la policy.
--   D  prueba un DELETE sobre esa muestra y cuenta cuántas pasan la policy.
--   I  prueba INSERT de copias de 8 filas (con id nuevo) y cuenta cuántas pasan el WITH CHECK.
--
-- Es seguro: cada prueba de escritura corre en un sub-bloque que SIEMPRE se deshace
-- (levanta una excepción a propósito), no se crea ninguna tabla ni dato, y las filas
-- que se tocan quedan bloqueadas solo unos milisegundos. Igual: correrlo en un momento
-- tranquilo (no en plena hora pico) y sin cerrar/abrir cajas mientras corre.
--
-- CÓMO USARLO
--   1. Antes de aplicar la migración: pegar TODO este archivo en el SQL Editor y ejecutar.
--      Guardar la salida (captura o exportar CSV). Tarda del orden de un minuto.
--   2. Aplicar supabase/migrations/098_rls_rendimiento.sql.
--   3. Correr este mismo archivo otra vez, sin cambiarlo, dentro de los 2-3 minutos siguientes.
--      Comparar la columna "huella" fila por fila con la corrida anterior.
--      Si alguna fila difiere: pegarme la columna "detalle" de las dos corridas, o revertir
--      con scripts/rls-rendimiento/098_reversion.sql.
--
-- Nota sobre los datos vivos: para que la venta normal del kiosco no altere la comparación,
-- solo se cuentan filas creadas hasta v_corte (tablas con created_at). Si lo corrés otro día,
-- podés dejar v_corte como está mientras las dos corridas usen el MISMO valor.

create or replace function pg_temp.rls_correr()
returns table (usuario text, tabla text, op text, resultado text)
language plpgsql
set lock_timeout = '3s'
as $fn$
declare
  v_corte constant timestamptz := timestamptz '2026-09-25 18:00:00+00';
  v_info   jsonb := '{}'::jsonb;
  t        record;
  u        record;
  v_where  text;
  v_cols   text;
  v_tiene  boolean;
  v_ident  boolean;
  v_uuid   boolean;
  v_ids    text[];
  v_filas  jsonb;
  v_i      jsonb;
  v_claims text;
  v_n      bigint;
  v_h      text;
  v_res    text;
  v_ok     int;
  v_den    int;
  v_row    jsonb;
begin
  -- 1) Muestras fijas por tabla, leídas como postgres (sin RLS).
  for t in
    select p.tablename::text as nombre from pg_policies p where p.schemaname = 'public' group by 1 order by 1
  loop
    select exists (select 1 from information_schema.columns c
                   where c.table_schema = 'public' and c.table_name = t.nombre and c.column_name = 'created_at')
      into v_tiene;
    v_where := case when v_tiene then format('created_at <= %L', v_corte) else 'true' end;

    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = format('public.%I', t.nombre)::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = '';

    select coalesce(bool_or(a.attidentity <> ''), false)
      into v_ident
      from pg_attribute a
     where a.attrelid = format('public.%I', t.nombre)::regclass and a.attnum > 0 and not a.attisdropped;

    select coalesce(bool_or(c.data_type = 'uuid'), false)
      into v_uuid
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t.nombre and c.column_name = 'id';

    execute format('select coalesce(array_agg(x.id::text), ''{}''::text[]) from (select id from public.%I where %s order by md5(id::text) limit 40) x', t.nombre, v_where)
      into v_ids;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from public.%I where %s order by md5(id::text) limit 8) x', t.nombre, v_where)
      into v_filas;

    v_info := v_info || jsonb_build_object(t.nombre, jsonb_build_object(
      'where', v_where, 'cols', v_cols, 'insertar', (v_uuid and not v_ident),
      'ids', to_jsonb(v_ids), 'filas', v_filas));
  end loop;

  -- 2) Cada usuario: se asume su rol y se prueba cada tabla.
  for u in
    select coalesce(nullif(x.raw_app_meta_data ->> 'role', ''), 'sin_rol') || '/' || left(x.id::text, 8) as etiqueta,
           x.id::text as sub, x.raw_app_meta_data ->> 'role' as rol, 'authenticated'::text as dbrole
      from auth.users x
    union all
    select 'anon', null, null, 'anon'
    union all
    select 'repartidor(sim)/' || left(z.id::text, 8), z.id::text, 'repartidor', 'authenticated'
      from (select id from auth.users where raw_app_meta_data ->> 'role' = 'vendedor' order by id limit 1) z
    union all
    select 'sin_rol(sim)/' || left(z.id::text, 8), z.id::text, null, 'authenticated'
      from (select id from auth.users where raw_app_meta_data ->> 'role' = 'vendedor' order by id offset 1 limit 1) z
    order by 1
  loop
    v_claims := case when u.sub is null then '{"role":"anon"}'
                     else jsonb_build_object('sub', u.sub, 'role', 'authenticated',
                            'app_metadata', case when u.rol is null then '{}'::jsonb else jsonb_build_object('role', u.rol) end)::text
                end;
    perform set_config('request.jwt.claims', v_claims, true);
    execute format('set local role %I', u.dbrole);

    for t in select k as nombre from jsonb_object_keys(v_info) k order by 1 loop
      v_i     := v_info -> t.nombre;
      v_where := v_i ->> 'where';
      v_ids   := array(select jsonb_array_elements_text(v_i -> 'ids'));

      -- S: filas visibles (conteo y hash de ids)
      begin
        execute format('select count(*), coalesce(left(md5(string_agg(id::text, '','' order by id::text)), 8), '''') from public.%I where %s', t.nombre, v_where)
          into v_n, v_h;
        v_res := v_n || ':' || v_h;
      exception when others then
        v_res := 'ERR ' || sqlstate;
      end;
      usuario := u.etiqueta; tabla := t.nombre; op := 'S'; resultado := v_res; return next;

      -- U: UPDATE sobre la muestra (siempre se deshace)
      v_res := null;
      begin
        execute format('update public.%I set id = id where id::text = any($1)', t.nombre) using v_ids;
        get diagnostics v_n = row_count;
        v_res := v_n::text;
        raise exception using errcode = 'P0001', message = '__rb__';
      exception when others then
        if sqlerrm <> '__rb__' then v_res := 'ERR ' || sqlstate || ' ' || left(sqlerrm, 40); end if;
      end;
      usuario := u.etiqueta; tabla := t.nombre; op := 'U'; resultado := v_res; return next;

      -- D: DELETE sobre la muestra (siempre se deshace)
      v_res := null;
      begin
        execute format('delete from public.%I where id::text = any($1)', t.nombre) using v_ids;
        get diagnostics v_n = row_count;
        v_res := v_n::text;
        raise exception using errcode = 'P0001', message = '__rb__';
      exception when others then
        if sqlerrm <> '__rb__' then v_res := 'ERR ' || sqlstate || ' ' || left(sqlerrm, 40); end if;
      end;
      usuario := u.etiqueta; tabla := t.nombre; op := 'D'; resultado := v_res; return next;

      -- I: INSERT de copias (id nuevo); cuenta cuántas pasan el WITH CHECK (siempre se deshace)
      if (v_i ->> 'insertar')::boolean then
        v_ok := 0; v_den := 0;
        for v_row in select value from jsonb_array_elements(v_i -> 'filas') loop
          begin
            execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, jsonb_set($1, ''{id}'', to_jsonb(gen_random_uuid())))',
                           t.nombre, v_i ->> 'cols') using v_row;
            v_ok := v_ok + 1;
            raise exception using errcode = 'P0001', message = '__rb__';
          exception when others then
            if sqlerrm = '__rb__' then null;
            elsif sqlstate = '42501' then v_den := v_den + 1;
            else v_ok := v_ok + 1;   -- otro error (unique, FK...): superó la policy
            end if;
          end;
        end loop;
        v_res := 'permitidas=' || v_ok || ' denegadas=' || v_den;
      else
        v_res := 'omitida';
      end if;
      usuario := u.etiqueta; tabla := t.nombre; op := 'I'; resultado := v_res; return next;
    end loop;

    execute 'reset role';
  end loop;
end
$fn$;

select r.usuario,
       count(*) as verificaciones,
       left(md5(string_agg(r.tabla || '|' || r.op || '|' || coalesce(r.resultado, 'null'), E'\n' order by r.tabla, r.op)), 12) as huella,
       string_agg(r.tabla || ' ' || r.op || ' ' || coalesce(r.resultado, 'null'), ' ; ' order by r.tabla, r.op) as detalle
  from pg_temp.rls_correr() r
 group by r.usuario
 order by r.usuario;
