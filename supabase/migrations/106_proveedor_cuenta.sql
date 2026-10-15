-- 106: Tesorería, cuenta corriente por proveedor y local (pagos a cuenta o en bloque y saldo inicial).
--
-- Contexto: hoy una compra "todavía se debe" se marca pagada entera, de una vez. En la práctica el administrativo paga en bloque
-- contra varios remitos, o paga una parte a cuenta, y lo que importa es el saldo por proveedor y por local:
--     saldo = saldo inicial + compras que todavía se deben − pagos
-- Esta tabla guarda las dos cosas que no son una compra: el SALDO INICIAL (lo que ya se debía antes de empezar a usar Tesorería,
-- una sola vez por proveedor y local) y cada PAGO (a cuenta, no atado a un remito). No se imputa cada pago a un remito: el saldo
-- sale de restar; qué remitos quedan cubiertos se calcula en pantalla (los más viejos primero) y no se guarda.
--
-- Qué NO cambia: las compras siguen siendo egresos (el gasto del mes cuenta por la fecha de la compra, esté pagada o no), así que
-- un pago acá NO es un gasto nuevo y no aparece en "Salió". Sí baja el efectivo de Tesorería cuando se paga en efectivo.
--
-- Nada se borra: un error se anula con motivo (igual que los egresos). Escribe solo el servidor (service_role); lo lee un admin.
-- Amplía además la lista de acciones permitidas del historial (104/105).
--
-- Orden de despliegue: la solapa «Proveedores» de Tesorería muestra un aviso hasta que se aplique.
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 105.

create table if not exists public.proveedor_cuenta (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('saldo_inicial', 'pago')),
  proveedor_id    uuid not null references public.proveedores(id),
  sucursal_id     uuid not null references public.sucursales(id),
  fecha           date not null,                      -- del pago; en el saldo inicial, la fecha de corte
  monto           numeric(14,2) not null check (monto > 0),
  origen          text check (origen in ('efectivo_tesoreria', 'transferencia', 'mercadopago')),
  nota            text,
  anulado_en      timestamptz,
  anulado_por     uuid references auth.users(id),
  anulado_motivo  text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  -- El pago dice de dónde salió la plata; el saldo inicial no es plata que se movió.
  constraint proveedor_cuenta_origen_chk check (
    (tipo = 'pago' and origen is not null) or (tipo = 'saldo_inicial' and origen is null)),
  constraint proveedor_cuenta_anulacion_chk check (
    anulado_en is null or (anulado_por is not null and anulado_motivo is not null))
);

-- Un solo saldo inicial vigente por proveedor y local (si se cargó mal, se anula y se carga de nuevo).
create unique index if not exists proveedor_cuenta_saldo_inicial_uni
  on public.proveedor_cuenta (proveedor_id, sucursal_id) where tipo = 'saldo_inicial' and anulado_en is null;
create index if not exists proveedor_cuenta_proveedor_idx on public.proveedor_cuenta (proveedor_id, sucursal_id, fecha desc);
create index if not exists proveedor_cuenta_efectivo_idx  on public.proveedor_cuenta (fecha)
  where tipo = 'pago' and origen = 'efectivo_tesoreria' and anulado_en is null;

comment on table  public.proveedor_cuenta is 'Cuenta corriente por proveedor y local: saldo inicial y pagos a cuenta. Saldo = saldo inicial + compras que se deben − pagos. No es un gasto.';
comment on column public.proveedor_cuenta.fecha is 'Fecha del pago (cuándo salió la plata) o, en el saldo inicial, la fecha de corte.';
comment on column public.proveedor_cuenta.origen is 'De dónde salió la plata del pago. Efectivo de Tesorería baja el efectivo en mano. Vacío en el saldo inicial.';

-- ── Historial (104/105): acciones nuevas ────────────────────────────────────
alter table public.tesoreria_historial drop constraint if exists tesoreria_historial_accion_check;
alter table public.tesoreria_historial add constraint tesoreria_historial_accion_check check (accion in (
  'egreso_creado', 'egreso_pagado', 'egreso_anulado',
  'entrega_descartada', 'entrega_restaurada',
  'efectivo_inicial_cambiado', 'permiso_cambiado',
  'mp_cobros_importados', 'mp_cobro_clasificado',
  'proveedor_saldo_inicial', 'proveedor_pago', 'proveedor_movimiento_anulado'));

-- ── Permisos y RLS ──────────────────────────────────────────────────────────
alter table public.proveedor_cuenta enable row level security;

revoke all on public.proveedor_cuenta from anon, authenticated;
grant select on public.proveedor_cuenta to authenticated;

drop policy if exists "proveedor_cuenta_select_admin" on public.proveedor_cuenta;
create policy "proveedor_cuenta_select_admin" on public.proveedor_cuenta for select to authenticated
  using ((select is_admin()));

-- ── Verificación (correr después) ───────────────────────────────────────────
-- select count(*) from public.proveedor_cuenta;                                             -- 0
-- select conname from pg_constraint where conrelid = 'public.tesoreria_historial'::regclass and contype = 'c';
--   -- tesoreria_historial_accion_check (con las 12 acciones)
-- select has_table_privilege('authenticated', 'public.proveedor_cuenta', 'insert'),
--        has_table_privilege('anon', 'public.proveedor_cuenta', 'select');                   -- false, false
--
-- Reversión (borra los pagos y saldos cargados; el historial conserva el rastro):
--   drop table if exists public.proveedor_cuenta;
--   -- y volver el check del historial a las 9 acciones de la 105 solo si no hay filas con las acciones nuevas.
