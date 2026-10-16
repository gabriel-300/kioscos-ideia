-- 03_medir_en_produccion.sql
--
-- Mide el efecto REAL de la migración 098 sobre el tráfico de producción, sin simular nada.
-- Correr en el SQL Editor (o pedírselo a Claude, que puede leer estas vistas por MCP).
-- La línea base se tomó el 2026-09-25 18:50 UTC, antes de aplicar la migración.
--
-- pg_stat_statements se reinició por última vez el 2026-06-17 y acumula desde entonces: por
-- eso se comparan DELTAS contra la línea base, no los promedios acumulados.

-- 1) La consulta de ventas de la sucursal con ítems (POS): queryid 6095973185492312135.
--    Línea base: 13.191 llamadas, 857,4 ms de media, 11.310,4 s acumulados.
--    "ms_medio_desde_baseline" es el promedio de las llamadas posteriores a la línea base.
select queryid::text,
       calls,
       calls - 13191                                                           as llamadas_desde_baseline,
       round(mean_exec_time::numeric, 1)                                       as ms_medio_acumulado,
       round(((total_exec_time - 11310400) / nullif(calls - 13191, 0))::numeric, 1) as ms_medio_desde_baseline
  from extensions.pg_stat_statements
 where queryid = 6095973185492312135;

-- 2) Lecturas secuenciales de profiles (línea base: 114.129.900 seq_scan el 2026-09-25 18:32 UTC).
--    Con my_sucursal_id() envuelto en (select ...) debería crecer órdenes de magnitud más lento.
select relname, seq_scan, seq_scan - 114129900 as seq_scan_desde_baseline, seq_tup_read, idx_scan, now() as ahora
  from pg_stat_user_tables
 where relname in ('profiles', 'movimientos', 'movimiento_items', 'aperturas_caja', 'cierres_caja', 'sucursales', 'retiros_caja')
 order by relname;
