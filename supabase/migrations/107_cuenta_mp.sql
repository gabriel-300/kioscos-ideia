-- 107: Tesorería, cuenta de Mercado Pago con saldo (saldo inicial y retiros).
--
-- Contexto: Tesorería ya sabía cuánto efectivo tiene Damián, pero no cuánta plata hay en Mercado Pago, así que «tengo menos debo»
-- solo contaba el efectivo. El saldo de la cuenta se arma así:
--     saldo = saldo inicial
--           + cobros importados (neto, ya sin la comisión de MP)                       (mp_cobros, migración 105)
--           + ingresos que no son venta y se clasificaron como entrada                (traspaso propio, aporte de socio, otro ingreso)
--           − pagos hechos con origen «Mercado Pago»                                   (egresos y pagos a proveedor)
--           − retiros de la cuenta (plata que Damián pasó a un banco o sacó)           (esta tabla)
-- Los cobros todavía no liberados por MP se muestran aparte («a liberar») y no son plata disponible.
--
-- Esta tabla guarda solo lo que no se puede deducir de lo demás: el SALDO INICIAL (con qué saldo arrancó la cuenta, un solo valor
-- vigente) y los RETIROS. Cuando se importe el reporte de movimientos de Mercado Pago, los retiros reales entrarán por ahí.
-- Nada se borra: un error se anula con motivo. Escribe solo el servidor (service_role); lo lee un admin.
--
-- Orden de despliegue: la solapa «Cuentas» de Tesorería muestra un aviso hasta que se aplique; el resto de Tesorería sigue igual.
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 106.

create table if not exists public.cuenta_mp (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('saldo_inicial', 'retiro')),
  fecha           date not null,          -- saldo inicial: el saldo es el de AL COMENZAR ese día; retiro: cuándo salió
  monto           numeric(14,2) not null,
  nota            text,
  anulado_en      timestamptz,
  anulado_por     uuid references auth.users(id),
  anulado_motivo  text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  -- El saldo inicial puede ser cero (la cuenta arrancó vacía); un retiro siempre mueve plata.
  constraint cuenta_mp_monto_chk check ((tipo = 'saldo_inicial' and monto >= 0) or (tipo = 'retiro' and monto > 0)),
  constraint cuenta_mp_anulacion_chk check (anulado_en is null or (anulado_por is not null and anulado_motivo is not null))
);

-- Un solo saldo inicial vigente (si se cargó mal, se anula y se carga de nuevo).
create unique index if not exists cuenta_mp_saldo_inicial_uni on public.cuenta_mp ((true)) where tipo = 'saldo_inicial' and anulado_en is null;
create index if not exists cuenta_mp_fecha_idx on public.cuenta_mp (fecha desc) where anulado_en is null;

comment on table  public.cuenta_mp is 'Saldo inicial y retiros de la cuenta de Mercado Pago. El resto del saldo se deduce de mp_cobros y de los pagos con origen mercadopago.';
comment on column public.cuenta_mp.fecha is 'Saldo inicial: el saldo es el de al comenzar ese día (los cobros de ese día ya suman). Retiro: fecha en que salió la plata.';

-- ── Historial (104/105/106): acciones nuevas ────────────────────────────────
alter table public.tesoreria_historial drop constraint if exists tesoreria_historial_accion_check;
alter table public.tesoreria_historial add constraint tesoreria_historial_accion_check check (accion in (
  'egreso_creado', 'egreso_pagado', 'egreso_anulado',
  'entrega_descartada', 'entrega_restaurada',
  'efectivo_inicial_cambiado', 'permiso_cambiado',
  'mp_cobros_importados', 'mp_cobro_clasificado',
  'proveedor_saldo_inicial', 'proveedor_pago', 'proveedor_movimiento_anulado',
  'mp_saldo_inicial', 'mp_retiro', 'mp_movimiento_anulado'));

-- ── Permisos y RLS ──────────────────────────────────────────────────────────
alter table public.cuenta_mp enable row level security;

revoke all on public.cuenta_mp from anon, authenticated;
grant select on public.cuenta_mp to authenticated;

drop policy if exists "cuenta_mp_select_admin" on public.cuenta_mp;
create policy "cuenta_mp_select_admin" on public.cuenta_mp for select to authenticated
  using ((select is_admin()));

-- ── Verificación (correr después) ───────────────────────────────────────────
-- select count(*) from public.cuenta_mp;                                                    -- 0
-- select conname from pg_constraint where conrelid = 'public.tesoreria_historial'::regclass and contype = 'c';
--   -- tesoreria_historial_accion_check (con las 15 acciones)
-- select has_table_privilege('authenticated', 'public.cuenta_mp', 'insert'),
--        has_table_privilege('anon', 'public.cuenta_mp', 'select');                          -- false, false
--
-- Reversión (borra el saldo inicial y los retiros cargados; el historial conserva el rastro):
--   drop table if exists public.cuenta_mp;
--   -- y volver el check del historial a las 12 acciones de la 106 solo si no hay filas con las acciones nuevas.
