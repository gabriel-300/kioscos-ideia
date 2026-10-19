-- 112: Tesorería, un pago a un proveedor se puede IMPUTAR a remitos o facturas concretos.
--
-- Contexto: hasta la 111 los pagos se restaban del saldo de la cuenta (proveedor × local) y el sistema calculaba, de la compra más
-- vieja a la más nueva, cuáles quedaban cubiertas. Eso no permite decir «este pago es del remito 2416». Esta tabla guarda esa
-- decisión: un pago puede repartirse entre varios remitos o facturas (con su monto cada uno). Lo que de un pago no se imputa sigue
-- cubriendo, como hasta ahora, el saldo inicial y las compras más viejas.
--
-- El saldo de la cuenta NO cambia (sigue siendo saldo inicial + compras que se deben − pagos): imputar solo define qué remito queda
-- cubierto. Por eso es aditivo: los pagos que ya existen quedan «sin imputar» y se comportan igual que antes.
--
-- Una imputación vale mientras su pago y su compra estén vigentes: si se anula el pago o la compra, la imputación se ignora (la
-- fila queda como registro, nunca se borra). Solo escribe el servidor (service_role).
--
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 111.

create table if not exists public.proveedor_pago_imputaciones (
  id          uuid primary key default gen_random_uuid(),
  pago_id     uuid not null references public.proveedor_cuenta(id) on delete cascade,
  egreso_id   uuid not null references public.egresos(id),         -- el remito o factura que cubre este pago
  monto       numeric(14,2) not null check (monto > 0),
  created_at  timestamptz not null default now(),
  constraint proveedor_pago_imputaciones_uni unique (pago_id, egreso_id)
);

create index if not exists proveedor_pago_imputaciones_egreso_idx on public.proveedor_pago_imputaciones (egreso_id);

comment on table  public.proveedor_pago_imputaciones is 'A qué remito o factura (egresos) se imputó un pago a proveedor (proveedor_cuenta.tipo = pago), y por cuánto. Un pago puede repartirse entre varias compras; lo no imputado cubre lo más viejo.';
comment on column public.proveedor_pago_imputaciones.egreso_id is 'Remito o factura que cubre este pago (egresos.id). Se ignora si el pago o la compra están anulados.';
comment on column public.proveedor_pago_imputaciones.monto is 'Parte del pago que cubre esa compra. La suma de un pago no supera el monto del pago ni lo que resta de cada compra (lo valida el servidor).';

alter table public.proveedor_pago_imputaciones enable row level security;

revoke all on public.proveedor_pago_imputaciones from anon, authenticated;
grant select on public.proveedor_pago_imputaciones to authenticated;

drop policy if exists "proveedor_pago_imputaciones_select_admin" on public.proveedor_pago_imputaciones;
create policy "proveedor_pago_imputaciones_select_admin" on public.proveedor_pago_imputaciones for select to authenticated
  using ((select is_admin()));

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select count(*) from public.proveedor_pago_imputaciones;                                                  -- 0
-- select policyname from pg_policies where tablename = 'proveedor_pago_imputaciones';                       -- 1 fila
--
-- Reversión:
--   drop table if exists public.proveedor_pago_imputaciones;
