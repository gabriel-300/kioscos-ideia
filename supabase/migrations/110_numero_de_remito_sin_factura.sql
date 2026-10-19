-- 110: Tesorería, el número de remito también se guarda en las compras SIN factura.
--
-- Contexto: Damián lleva cada compra por el número de su remito, tenga o no factura (su planilla de proveedores tiene una columna
-- «Remito» en todas las filas). La tabla egresos tenía un CHECK (migración 101) que solo dejaba guardar `comprobante_numero` cuando
-- el egreso era «con factura»; por eso el número de un remito sin factura había que escribirlo dentro de la descripción.
--
-- Este cambio saca ese CHECK: `comprobante_numero` pasa a ser «número de remito o de factura», con o sin factura. No toca datos ni
-- ninguna otra tabla. Los egresos que ya tienen el número en la descripción quedan como están.
--
-- Orden de despliegue: el código nuevo manda el número también en compras sin factura; sin esta migración esa carga falla con un
-- error de la base. Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 109.

alter table public.egresos drop constraint if exists egresos_numero_solo_con_comprobante;

comment on column public.egresos.comprobante_numero is
  'Número del remito o de la factura (con o sin factura). Opcional.';

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select count(*) from pg_constraint where conrelid = 'public.egresos'::regclass and conname = 'egresos_numero_solo_con_comprobante';  -- 0
--
-- Reversión (solo sirve si ningún egreso sin factura tiene número):
--   alter table public.egresos add constraint egresos_numero_solo_con_comprobante check (comprobante = 'con' or comprobante_numero is null);
