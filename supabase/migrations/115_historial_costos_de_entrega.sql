-- 115: Tesorería, el historial anota cuándo el administrativo carga los costos de una mercadería que ingresó al kiosco.
--
-- Contexto: el personal del kiosco registra la recepción de mercadería solo para el stock (producto y cantidad, sin precios: los
-- precios los cargaba mal). Los costos los completa después el administrativo en Tesorería, mirando la factura o el remito. Ese
-- cambio mueve plata (costos, márgenes, alertas de precio), así que deja una fila en el historial inmutable (migración 104).
--
-- Solo amplía la lista de acciones permitidas del historial; no toca datos. Idempotente. Correr a mano en el SQL Editor de Supabase,
-- después de la 114. Orden de despliegue: sin esta migración, guardar los costos de una entrega termina con un aviso de que no se
-- pudo anotar en el historial (los costos sí se guardan).

alter table public.tesoreria_historial drop constraint if exists tesoreria_historial_accion_check;
alter table public.tesoreria_historial add constraint tesoreria_historial_accion_check check (accion in (
  'egreso_creado', 'egreso_pagado', 'egreso_anulado',
  'entrega_descartada', 'entrega_restaurada',
  'efectivo_inicial_cambiado', 'permiso_cambiado',
  'mp_cobros_importados', 'mp_cobro_clasificado',
  'proveedor_saldo_inicial', 'proveedor_pago', 'proveedor_movimiento_anulado',
  'mp_saldo_inicial', 'mp_retiro', 'mp_movimiento_anulado',
  'peya_liquidacion_importada', 'peya_liquidacion_confirmada', 'peya_acreditacion_registrada', 'peya_conciliacion_manual',
  'peya_pedido_revisado',
  'egreso_vencimiento',
  'entrega_costos'));

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'tesoreria_historial_accion_check';   -- incluye 'entrega_costos'
--
-- Reversión (solo sirve si no hay historial con esa acción):
--   alter table public.tesoreria_historial drop constraint if exists tesoreria_historial_accion_check;
--   (volver a crearlo con la lista de la migración 113)
