-- 113: Tesorería, fecha de vencimiento de un remito o factura de proveedor (para el listado de deuda vencida y a vencer).
--
-- Contexto: la cuenta de cada proveedor sabe cuánto se debe, pero no cuándo vence cada comprobante, así que no se podía separar lo
-- vencido de lo que todavía está a tiempo. Se agrega la fecha de vencimiento, opcional (muchas compras no tienen plazo): un
-- comprobante sin fecha figura en el listado como «sin vencimiento». Se carga al cargar el remito o la factura, y se puede cargar o
-- corregir después desde la cuenta del proveedor; cada cambio queda en el historial (acción egreso_vencimiento).
--
-- Aditivo y sin efecto sobre saldos, cierres ni stock. Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 112.
-- Orden de despliegue: sin esta migración, cargar un remito con vencimiento o fijarlo falla, y el listado dice que falta aplicarla.

alter table public.egresos add column if not exists fecha_vencimiento date;

alter table public.egresos drop constraint if exists egresos_vencimiento_chk;
alter table public.egresos add constraint egresos_vencimiento_chk
  check (fecha_vencimiento is null or fecha_vencimiento >= fecha);

-- El listado mira solo lo que todavía se debe y tiene vencimiento.
create index if not exists egresos_vencimiento_idx
  on public.egresos (fecha_vencimiento) where pagado = false and anulado_en is null and fecha_vencimiento is not null;

comment on column public.egresos.fecha_vencimiento is
  'Fecha hasta la que hay que pagar el remito o factura. Vacío = sin vencimiento. Nunca anterior a la fecha de la compra. Solo importa mientras se debe (pagado = false).';

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
  'egreso_vencimiento'));

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select column_name from information_schema.columns where table_name = 'egresos' and column_name = 'fecha_vencimiento';  -- 1 fila
-- select count(*) from public.egresos where fecha_vencimiento is not null;                                             -- 0
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'tesoreria_historial_accion_check';             -- incluye 'egreso_vencimiento'
--
-- Reversión (solo sirve si no hay historial con esa acción):
--   drop index if exists public.egresos_vencimiento_idx;
--   alter table public.egresos drop constraint if exists egresos_vencimiento_chk;
--   alter table public.egresos drop column if exists fecha_vencimiento;
