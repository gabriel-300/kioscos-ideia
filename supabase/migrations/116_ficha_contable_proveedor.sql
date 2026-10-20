-- 116: Tesorería, ficha contable de cada proveedor (con lo que hace falta para la contabilidad y, más adelante, para ARCA).
--
-- Contexto: hoy un proveedor es solo un nombre, un contacto y cómo factura. Para llevar la contabilidad hace falta saber a quién se le
-- compra: razón social, CUIT, condición frente al IVA, si da factura, qué rubro es, cómo y cuándo se le paga. Todos los datos son
-- opcionales (no bloquean cargar ni pagar nada): la pantalla marca qué falta completar de cada proveedor.
--
-- También evita los duplicados que ya aparecieron («petri», «Petri panadería»): el nombre es único sin importar mayúsculas ni espacios
-- de los costados, y el CUIT es único cuando está cargado. El código además avisa de nombres parecidos antes de crear uno nuevo.
--
-- Aditivo: no cambia ningún dato existente ni cómo se calculan costos, saldos o stock. Idempotente. Correr a mano en el SQL Editor de
-- Supabase, después de la 115. Orden de despliegue: el código lee estas columnas; sin esta migración fallan Tesorería y Catálogo →
-- Proveedores. Si hay dos proveedores con el mismo nombre o CUIT repetido, la migración falla en los índices únicos: unificarlos antes.

alter table public.proveedores add column if not exists razon_social text;
alter table public.proveedores add column if not exists cuit         text;
alter table public.proveedores add column if not exists condicion_iva text;
alter table public.proveedores add column if not exists da_factura   text;
alter table public.proveedores add column if not exists rubro        text;
alter table public.proveedores add column if not exists forma_pago   text;
alter table public.proveedores add column if not exists alias_cbu    text;
alter table public.proveedores add column if not exists email        text;
alter table public.proveedores add column if not exists notas        text;

alter table public.proveedores drop constraint if exists proveedores_cuit_chk;
alter table public.proveedores add constraint proveedores_cuit_chk check (cuit is null or cuit ~ '^[0-9]{11}$');

alter table public.proveedores drop constraint if exists proveedores_condicion_iva_chk;
alter table public.proveedores add constraint proveedores_condicion_iva_chk
  check (condicion_iva is null or condicion_iva in ('responsable_inscripto', 'monotributo', 'exento', 'no_responsable'));

alter table public.proveedores drop constraint if exists proveedores_da_factura_chk;
alter table public.proveedores add constraint proveedores_da_factura_chk
  check (da_factura is null or da_factura in ('siempre', 'a_veces', 'nunca'));

alter table public.proveedores drop constraint if exists proveedores_rubro_chk;
alter table public.proveedores add constraint proveedores_rubro_chk
  check (rubro is null or rubro in ('mercaderia', 'servicios', 'alquiler', 'otro'));

alter table public.proveedores drop constraint if exists proveedores_forma_pago_chk;
alter table public.proveedores add constraint proveedores_forma_pago_chk
  check (forma_pago is null or forma_pago in ('efectivo_tesoreria', 'transferencia', 'mercadopago'));

create unique index if not exists proveedores_cuit_uni on public.proveedores (cuit) where cuit is not null;
create unique index if not exists proveedores_nombre_uni on public.proveedores ((lower(btrim(nombre))));

comment on column public.proveedores.razon_social  is 'Nombre legal tal como figura en la factura. Opcional.';
comment on column public.proveedores.cuit          is 'CUIT de 11 dígitos, sin guiones. Único entre proveedores. Opcional (los informales no tienen).';
comment on column public.proveedores.condicion_iva is 'responsable_inscripto, monotributo, exento o no_responsable. Opcional.';
comment on column public.proveedores.da_factura    is 'siempre, a_veces o nunca: precarga «con factura» o «sin factura» al cargar una compra. Opcional.';
comment on column public.proveedores.rubro         is 'Qué se le compra, habitualmente: mercaderia, servicios, alquiler u otro. Opcional.';
comment on column public.proveedores.forma_pago    is 'Cómo se le suele pagar: efectivo_tesoreria, transferencia o mercadopago. Opcional.';
comment on column public.proveedores.alias_cbu     is 'Alias o CBU/CVU para transferirle. Opcional.';
comment on column public.proveedores.email         is 'Email del proveedor. Opcional.';
comment on column public.proveedores.notas         is 'Notas libres sobre el proveedor. Opcional.';

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
  'entrega_costos',
  'proveedor_ficha'));

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select count(*) from information_schema.columns where table_name = 'proveedores' and column_name in
--   ('razon_social', 'cuit', 'condicion_iva', 'da_factura', 'rubro', 'forma_pago', 'alias_cbu', 'email', 'notas');   -- 9
-- select indexname from pg_indexes where tablename = 'proveedores' and indexname in ('proveedores_cuit_uni', 'proveedores_nombre_uni');  -- 2 filas
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'tesoreria_historial_accion_check';        -- incluye 'proveedor_ficha'
--
-- Reversión (solo sirve si no hay historial con la acción proveedor_ficha):
--   drop index if exists public.proveedores_cuit_uni, public.proveedores_nombre_uni;
--   alter table public.proveedores drop column if exists razon_social, drop column if exists cuit, drop column if exists condicion_iva,
--     drop column if exists da_factura, drop column if exists rubro, drop column if exists forma_pago, drop column if exists alias_cbu,
--     drop column if exists email, drop column if exists notas;
--   (y volver a crear el CHECK del historial con la lista de la migración 115)
