-- 109: Tesorería, «Para revisar»: poder dejar como revisado un pedido de PedidosYa que no cruza con ninguna venta.
--
-- Contexto: cuando PedidosYa entregó un pedido y el kiosco no lo cargó (o lo cargó con otro importe), el sistema lo marca como
-- «sin venta» o «importe distinto» y ahora además genera una alerta (panel «Para revisar» del Resumen y aviso en el menú). Para que
-- la alerta no quede para siempre cuando ya se averiguó qué pasó, el administrativo deja el pedido «revisado» con una nota. No se
-- borra ni se cambia nada del pedido: solo se anota quién lo revisó, cuándo y qué encontró.
--
-- Escribe solo el servidor (service_role). Agrega una acción al historial (se repiten todas las anteriores).
-- Orden de despliegue: sin esta migración la alerta no se puede cerrar y la pantalla de la liquidación muestra un aviso.
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 108.

alter table public.peya_pedidos
  add column if not exists revisado_en   timestamptz,
  add column if not exists revisado_por  uuid references auth.users(id),
  add column if not exists revisado_nota text;

create index if not exists peya_pedidos_para_revisar_idx on public.peya_pedidos (liquidacion_id)
  where revisado_en is null and conciliacion in ('sin_venta', 'importe_distinto');

comment on column public.peya_pedidos.revisado_en is 'Cuándo el administrativo dio por revisado un pedido que no cruzó con una venta (sin_venta o importe_distinto). Mientras sea null genera una alerta.';
comment on column public.peya_pedidos.revisado_nota is 'Qué se averiguó (por ejemplo: «el local se olvidó de cargarla, se ajustó el stock»). Obligatoria al marcar como revisado.';

-- ── Historial: acción nueva (se repiten todas las anteriores) ───────────────
alter table public.tesoreria_historial drop constraint if exists tesoreria_historial_accion_check;
alter table public.tesoreria_historial add constraint tesoreria_historial_accion_check check (accion in (
  'egreso_creado', 'egreso_pagado', 'egreso_anulado',
  'entrega_descartada', 'entrega_restaurada',
  'efectivo_inicial_cambiado', 'permiso_cambiado',
  'mp_cobros_importados', 'mp_cobro_clasificado',
  'proveedor_saldo_inicial', 'proveedor_pago', 'proveedor_movimiento_anulado',
  'mp_saldo_inicial', 'mp_retiro', 'mp_movimiento_anulado',
  'peya_liquidacion_importada', 'peya_liquidacion_confirmada', 'peya_acreditacion_registrada', 'peya_conciliacion_manual',
  'peya_pedido_revisado'));

-- ── Verificación (correr después) ───────────────────────────────────────────
-- select column_name from information_schema.columns where table_name = 'peya_pedidos' and column_name like 'revisado%';   -- 3 filas
-- select pg_get_constraintdef(oid) like '%peya_pedido_revisado%' from pg_constraint
--  where conrelid = 'public.tesoreria_historial'::regclass and conname = 'tesoreria_historial_accion_check';                -- true
--
-- Reversión (pierde las notas de revisión; el historial conserva el rastro):
--   alter table public.peya_pedidos drop column revisado_en, drop column revisado_por, drop column revisado_nota;
--   -- y volver el check del historial a las 19 acciones de la 108 solo si no hay filas con 'peya_pedido_revisado'.
