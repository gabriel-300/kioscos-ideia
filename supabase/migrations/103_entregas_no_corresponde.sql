-- 103: Tesorería, "no corresponde" para los ingresos de mercadería y pago a proveedor autorizado en el retiro de caja.
--
-- Contexto: la contabilidad de mercadería nace de la factura o el remito (el administrativo carga una "Nueva compra" y,
-- si quiere, vincula los ingresos del kiosco). Los ingresos del kiosco pasan a ser un CONTROL de conciliación: los que no
-- tienen compra asociada se listan aparte. Algunos nunca van a tener compra (una carga duplicada, una prueba, una
-- transferencia entre kioscos): el administrativo los marca "no corresponde", con motivo, para que no queden como una deuda eterna.
--
-- Además, el retiro de caja tiene dos usos: compra puntual de emergencia (lo normal) y, esporádicamente, pago a un proveedor
-- en efectivo AUTORIZADO POR UN ADMINISTRADOR. Para el segundo caso, retiros_caja gana proveedor_id y autorizado_por (con un CHECK:
-- si hay proveedor, tiene que haber quien lo autorizó). El retiro común no cambia.
--
-- Qué agrega (aditivo; no toca stock ni cerrar_caja): tres columnas en movimientos (quién, cuándo y por qué se descartó) y un CHECK
-- para que una entrega no pueda estar a la vez vinculada a un egreso y descartada. Descartar no cambia el stock: es solo una
-- marca de Tesorería (la entrega sigue sumando stock igual).
--
-- Orden de despliegue: la pantalla de Tesorería usa estas columnas; hasta que se aplique, muestra el aviso "Falta aplicar la 103".
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 102.

alter table public.movimientos
  add column if not exists tesoreria_descartado_en     timestamptz,
  add column if not exists tesoreria_descartado_por    uuid references auth.users(id),
  add column if not exists tesoreria_descartado_motivo text;

alter table public.movimientos drop constraint if exists movimientos_descarte_tesoreria_coherente;
alter table public.movimientos add constraint movimientos_descarte_tesoreria_coherente check (
  (tesoreria_descartado_en is not null or (tesoreria_descartado_por is null and tesoreria_descartado_motivo is null))
  and (egreso_id is null or tesoreria_descartado_en is null)
);

-- Retiro de caja: pago a un proveedor autorizado por un administrador (opcional).
alter table public.retiros_caja
  add column if not exists proveedor_id   uuid references public.proveedores(id) on delete restrict,
  add column if not exists autorizado_por uuid references auth.users(id);

alter table public.retiros_caja drop constraint if exists retiros_proveedor_requiere_autorizacion;
alter table public.retiros_caja add constraint retiros_proveedor_requiere_autorizacion check (proveedor_id is null or autorizado_por is not null);

comment on column public.retiros_caja.proveedor_id   is 'Pago a proveedor en efectivo desde la caja (esporádico). Vacío = compra puntual de emergencia.';
comment on column public.retiros_caja.autorizado_por is 'Administrador que autorizó el pago a proveedor. Obligatorio si hay proveedor_id.';

-- La bandeja de control mira solo las entregas sin egreso y sin descartar (reemplaza al índice de la 101, que no miraba el descarte).
drop index if exists public.movimientos_entrega_sin_egreso_idx;
create index if not exists movimientos_entrega_sin_conciliar_idx
  on public.movimientos (sucursal_id, fecha)
  where tipo = 'entrega' and egreso_id is null and tesoreria_descartado_en is null;

comment on column public.movimientos.tesoreria_descartado_en is
  'Solo entregas: el administrativo la marcó "no corresponde" en Tesorería (no tiene compra que registrar). No afecta el stock.';

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'movimientos'
--  and column_name like 'tesoreria_descartado%';                                           -- 3 filas
-- select conname from pg_constraint where conrelid = 'public.movimientos'::regclass and conname = 'movimientos_descarte_tesoreria_coherente';  -- 1 fila
-- select count(*) from public.movimientos where tesoreria_descartado_en is not null;       -- 0
-- select column_name from information_schema.columns where table_name = 'retiros_caja' and column_name in ('proveedor_id', 'autorizado_por');  -- 2 filas
--
-- Reversión:
--   alter table public.movimientos drop constraint if exists movimientos_descarte_tesoreria_coherente;
--   drop index if exists public.movimientos_entrega_sin_conciliar_idx;
--   create index if not exists movimientos_entrega_sin_egreso_idx on public.movimientos (sucursal_id, fecha) where tipo = 'entrega' and egreso_id is null;
--   alter table public.retiros_caja drop constraint if exists retiros_proveedor_requiere_autorizacion;
--   alter table public.retiros_caja drop column if exists proveedor_id, drop column if exists autorizado_por;
--   alter table public.movimientos drop column if exists tesoreria_descartado_en, drop column if exists tesoreria_descartado_por, drop column if exists tesoreria_descartado_motivo;
