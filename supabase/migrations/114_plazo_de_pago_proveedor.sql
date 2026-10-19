-- 114: plazo de pago de cada proveedor, para que el vencimiento de un remito o factura se precargue solo.
--
-- Contexto: la 113 agregó la fecha de vencimiento a cada remito o factura, y hay que cargarla a mano en cada uno. Si un proveedor
-- siempre da, por ejemplo, 15 días, el formulario puede proponer «fecha de la compra + 15 días» (y quien carga lo corrige si hace
-- falta). Este campo guarda ese plazo por proveedor. Vacío = el proveedor no tiene un plazo fijo: no se propone nada.
--
-- Aditivo y sin efecto sobre saldos, cierres, stock ni lo ya cargado: no cambia ningún vencimiento existente.
-- Se edita en Catálogo → Proveedores. Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 113.
-- Orden de despliegue: el código lee proveedores.plazo_pago_dias; sin esta migración fallan las pantallas de proveedores.

alter table public.proveedores add column if not exists plazo_pago_dias smallint;

alter table public.proveedores drop constraint if exists proveedores_plazo_pago_chk;
alter table public.proveedores add constraint proveedores_plazo_pago_chk
  check (plazo_pago_dias is null or (plazo_pago_dias >= 0 and plazo_pago_dias <= 365));

comment on column public.proveedores.plazo_pago_dias is
  'Días de plazo para pagar lo que nos entrega (0 = contado). Vacío = sin plazo fijo. Solo sirve para proponer el vencimiento al cargar un remito o factura (fecha de la compra + plazo); no cambia vencimientos ya cargados.';

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select column_name from information_schema.columns where table_name = 'proveedores' and column_name = 'plazo_pago_dias';  -- 1 fila
-- select count(*) from public.proveedores where plazo_pago_dias is not null;                                               -- 0
--
-- Reversión:
--   alter table public.proveedores drop constraint if exists proveedores_plazo_pago_chk;
--   alter table public.proveedores drop column if exists plazo_pago_dias;
