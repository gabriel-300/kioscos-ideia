-- 02_explain_pos.sql
--
-- Mide con EXPLAIN (ANALYZE) la carga típica del POS con RLS REAL, como vendedor y como
-- encargado. Correr en el SQL Editor de Supabase (como postgres) ANTES y DESPUES de aplicar
-- la migración 098 y comparar "Execution Time" (y "Buffers: shared hit").
--
-- Se corre de a UN bloque por vez (el editor muestra el resultado de la última sentencia).
-- Son solo lecturas: no modifican nada. Usuarios reales de producción (se leen sus policies
-- reales, no hay ningún dato de prueba):
--   vendedor  = 59ba8f0c-4fe5-4373-a726-5149ea3c3485 (Parque de las Fiestas)
--   encargado = 5cd7c27c-6fb7-4442-a171-242615eea4d5 (Parque de las Fiestas)
--   sucursal Parque de las Fiestas = d120dc6f-9754-46d0-94d0-a1fd5b05aa74
--
-- Conviene correr cada bloque 2-3 veces y quedarse con la última (la primera calienta la caché).

-- ============================================================================
-- BLOQUE 1: listado de ventas de la sucursal con sus ítems, como VENDEDOR
-- (lo que pide la pantalla de la sucursal; es la consulta más pesada del sistema:
--  en pg_stat_statements lleva ~857 ms de media y ~11.300 s acumulados)
-- ============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"59ba8f0c-4fe5-4373-a726-5149ea3c3485","role":"authenticated","app_metadata":{"role":"vendedor"}}';
explain (analyze, buffers, summary on)
select m.id, m.fecha, m.tipo, m.canal, m.created_at, m.created_by, m.pago_efectivo, m.pago_billetera,
       m.pago_tarjeta, m.pago_transferencia, m.anulado_en,
       (select jsonb_agg(jsonb_build_object('id', i.id, 'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario,
                                            'subtotal', i.subtotal, 'product_id', i.product_id))
          from public.movimiento_items i where i.movimiento_id = m.id) as movimiento_items
  from public.movimientos m
 where m.sucursal_id = 'd120dc6f-9754-46d0-94d0-a1fd5b05aa74'
 order by m.fecha desc, m.created_at desc
 limit 200;

-- ============================================================================
-- BLOQUE 2: lo mismo como ENCARGADO (copiar y ejecutar por separado)
-- ============================================================================
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"5cd7c27c-6fb7-4442-a171-242615eea4d5","role":"authenticated","app_metadata":{"role":"encargado"}}';
-- explain (analyze, buffers, summary on)
-- select m.id, m.fecha, m.tipo, m.canal, m.created_at, m.created_by, m.pago_efectivo, m.pago_billetera,
--        m.pago_tarjeta, m.pago_transferencia, m.anulado_en,
--        (select jsonb_agg(jsonb_build_object('id', i.id, 'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario,
--                                             'subtotal', i.subtotal, 'product_id', i.product_id))
--           from public.movimiento_items i where i.movimiento_id = m.id) as movimiento_items
--   from public.movimientos m
--  where m.sucursal_id = 'd120dc6f-9754-46d0-94d0-a1fd5b05aa74'
--  order by m.fecha desc, m.created_at desc
--  limit 200;

-- ============================================================================
-- BLOQUE 3: caja del turno (apertura + cierres + retiros), como VENDEDOR
-- ============================================================================
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"59ba8f0c-4fe5-4373-a726-5149ea3c3485","role":"authenticated","app_metadata":{"role":"vendedor"}}';
-- explain (analyze, buffers, summary on)
-- select (select count(*) from public.aperturas_caja where sucursal_id = 'd120dc6f-9754-46d0-94d0-a1fd5b05aa74') as aperturas,
--        (select count(*) from public.cierres_caja   where sucursal_id = 'd120dc6f-9754-46d0-94d0-a1fd5b05aa74') as cierres,
--        (select count(*) from public.retiros_caja   where sucursal_id = 'd120dc6f-9754-46d0-94d0-a1fd5b05aa74') as retiros,
--        (select count(*) from public.profiles) as perfiles;

-- ============================================================================
-- BLOQUE 4: ítems de ventas sin filtrar por sucursal (pide movimiento_items sola), como VENDEDOR
-- ============================================================================
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"59ba8f0c-4fe5-4373-a726-5149ea3c3485","role":"authenticated","app_metadata":{"role":"vendedor"}}';
-- explain (analyze, buffers, summary on)
-- select count(*) from public.movimiento_items;
