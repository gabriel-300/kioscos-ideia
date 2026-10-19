-- 111: Tesorería, un retiro de caja que paga a un proveedor se registra como PAGO a su cuenta (no como un gasto nuevo).
--
-- Contexto: el kiosco puede sacar plata del cajón para pagar a un proveedor, autorizado por un administrador (migración 103:
-- retiros_caja.proveedor_id y autorizado_por). La compra se carga como remito («todavía se debe») en la cuenta del proveedor. Si ese
-- retiro se registrara como un egreso, el gasto se contaría dos veces (el remito y el retiro) y el remito seguiría figurando como
-- deuda. Registrarlo como pago a la cuenta lo resuelve: baja el saldo, no es un gasto y no toca el efectivo ni Mercado Pago (la
-- plata salió del cajón del kiosco, no de Tesorería).
--
-- Qué agrega (aditivo; no toca cerrar_caja ni el stock):
--   * proveedor_cuenta.origen admite 'retiro_caja'.
--   * Un remito o factura no se carga dos veces: índice único (proveedor, kiosco, N°) entre los egresos vigentes. El código ya lo
--     controla antes de guardar; el índice lo hace valer en la base aunque dos personas carguen a la vez. IMPORTANTE: si ya hay
--     números repetidos la migración falla; primero hay que correr el script que pasa los números de remito al campo y revisar los
--     repetidos (ver verificación al final).
--   * retiros_caja.proveedor_cuenta_id: el pago al que se imputó el retiro. Un retiro está «registrado» si tiene egreso_id (gasto) o
--     proveedor_cuenta_id (pago a proveedor), nunca los dos.
--
-- Orden de despliegue: el código nuevo filtra los retiros pendientes por proveedor_cuenta_id; sin esta migración la bandeja de
-- retiros de Tesorería falla. Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 110.

-- ── 1) El pago puede salir de un retiro de caja ────────────────────────────
alter table public.proveedor_cuenta drop constraint if exists proveedor_cuenta_origen_check;
alter table public.proveedor_cuenta add constraint proveedor_cuenta_origen_check
  check (origen is null or origen in ('efectivo_tesoreria', 'transferencia', 'mercadopago', 'retiro_caja'));

comment on column public.proveedor_cuenta.origen is
  'De dónde salió la plata del pago. Efectivo de Tesorería y Mercado Pago bajan sus saldos; retiro_caja salió del cajón de un kiosco y no toca ninguno. Vacío en el saldo inicial.';

-- ── 2) Vínculo retiro → pago ────────────────────────────────────────────────
alter table public.retiros_caja
  add column if not exists proveedor_cuenta_id uuid references public.proveedor_cuenta(id) on delete set null;

alter table public.retiros_caja drop constraint if exists retiros_caja_un_solo_destino;
alter table public.retiros_caja add constraint retiros_caja_un_solo_destino
  check (egreso_id is null or proveedor_cuenta_id is null);

-- La bandeja «Para registrar» mira solo los retiros sin egreso y sin pago (reemplaza al índice de la 101).
drop index if exists public.retiros_caja_sin_egreso_idx;
create index if not exists retiros_caja_sin_registrar_idx
  on public.retiros_caja (sucursal_id, fecha) where egreso_id is null and proveedor_cuenta_id is null;
create index if not exists retiros_caja_proveedor_cuenta_idx
  on public.retiros_caja (proveedor_cuenta_id) where proveedor_cuenta_id is not null;

comment on column public.retiros_caja.proveedor_cuenta_id is
  'Pago a la cuenta de un proveedor (proveedor_cuenta) al que se imputó este retiro. Vacío = no se imputó a un pago. Excluyente con egreso_id.';

-- ── 3) Un remito o factura no se carga dos veces (mismo proveedor, kiosco y número) ──────────────
create unique index if not exists egresos_remito_unico
  on public.egresos (proveedor_id, sucursal_id, comprobante_numero)
  where anulado_en is null and proveedor_id is not null and sucursal_id is not null and comprobante_numero is not null;

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'proveedor_cuenta_origen_check';   -- incluye 'retiro_caja'
-- select column_name from information_schema.columns where table_name = 'retiros_caja' and column_name = 'proveedor_cuenta_id';  -- 1 fila
-- select count(*) from public.retiros_caja where proveedor_cuenta_id is not null;                          -- 0
-- select indexname from pg_indexes where indexname = 'egresos_remito_unico';                               -- 1 fila
-- Antes de aplicarla, para ver si hay números repetidos que la harían fallar (debe dar 0 filas):
--   select proveedor_id, sucursal_id, comprobante_numero, count(*) from public.egresos
--    where anulado_en is null and proveedor_id is not null and sucursal_id is not null and comprobante_numero is not null
--    group by 1, 2, 3 having count(*) > 1;
--
-- Reversión (solo sirve si ningún pago usa origen 'retiro_caja'):
--   drop index if exists public.egresos_remito_unico;
--   alter table public.retiros_caja drop constraint if exists retiros_caja_un_solo_destino;
--   drop index if exists public.retiros_caja_sin_registrar_idx, public.retiros_caja_proveedor_cuenta_idx;
--   alter table public.retiros_caja drop column if exists proveedor_cuenta_id;
--   create index if not exists retiros_caja_sin_egreso_idx on public.retiros_caja (sucursal_id, fecha) where egreso_id is null;
--   alter table public.proveedor_cuenta drop constraint if exists proveedor_cuenta_origen_check;
--   alter table public.proveedor_cuenta add constraint proveedor_cuenta_origen_check check (origen in ('efectivo_tesoreria', 'transferencia', 'mercadopago'));
