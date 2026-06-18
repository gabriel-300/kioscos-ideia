-- ============================================================
-- Agrega 'venta' como tipo válido de movimiento
-- Correr en Supabase → SQL Editor → New query → Run
-- ============================================================

-- El nombre del constraint inline es movimientos_tipo_check
alter table public.movimientos drop constraint if exists movimientos_tipo_check;
alter table public.movimientos
  add constraint movimientos_tipo_check
  check (tipo in ('entrega', 'devolucion', 'ajuste', 'venta'));
