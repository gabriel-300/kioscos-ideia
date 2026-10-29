-- 129: Tesorería, cuenta corriente de las personas (socios hoy; personal más adelante).
--
-- Contexto: un socio puede retirar plata como ADELANTO que después repone (devolviendo la plata o con un descuento de su sueldo).
-- Cargarlo como egreso «Retiro de socio» lo contaba como gasto y no tenía dónde registrar la devolución. Esta tabla lleva, por persona:
--     debe = saldo inicial + adelantos − reposiciones − descuentos de sueldo
--   * saldo_inicial   : lo que ya debía al arrancar (uno solo vigente por persona; no mueve ninguna cuenta).
--   * adelanto        : plata que se llevó. Con origen efectivo_tesoreria baja el efectivo en mano; con mercadopago baja el saldo de
--                       Mercado Pago; con transferencia no toca ninguna cuenta (no se llevan bancos).
--   * reposicion      : plata que devolvió. Con origen efectivo_tesoreria SUBE el efectivo; con mercadopago sube Mercado Pago.
--   * descuento_sueldo: se le descontó del sueldo. Resta de lo que debe y NO mueve ninguna cuenta (esa plata nunca salió: el sueldo
--                       se carga por el monto final que se pagó).
-- Solo cuentan los movimientos desde la fecha del saldo inicial (el saldo inicial ya trae todo lo anterior).
--
-- Nada se borra: un error se anula con motivo. Escribe solo el servidor (service_role); lo lee un admin.
-- Orden de despliegue: la solapa «Socios» muestra un aviso hasta que se aplique; el resto de Tesorería sigue igual (las lecturas que
-- suman al efectivo y a Mercado Pago toleran que la tabla no exista).
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 128.

create table if not exists public.persona_cuenta (
  id              uuid primary key default gen_random_uuid(),
  persona_id      uuid not null references public.profiles(id),
  tipo            text not null check (tipo in ('saldo_inicial', 'adelanto', 'reposicion', 'descuento_sueldo')),
  fecha           date not null,          -- saldo inicial: el saldo es el de AL COMENZAR ese día; el resto: cuándo pasó
  monto           numeric(14,2) not null,
  origen          text check (origen in ('efectivo_tesoreria', 'transferencia', 'mercadopago')),
  nota            text,
  anulado_en      timestamptz,
  anulado_por     uuid references auth.users(id),
  anulado_motivo  text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  -- El saldo inicial puede ser cero; cualquier otro movimiento mueve plata.
  constraint persona_cuenta_monto_chk check ((tipo = 'saldo_inicial' and monto >= 0) or (tipo <> 'saldo_inicial' and monto > 0)),
  -- Adelanto y reposición dicen de dónde salió / adónde entró la plata; el saldo inicial y el descuento de sueldo no mueven plata.
  constraint persona_cuenta_origen_chk check ((tipo in ('adelanto', 'reposicion') and origen is not null) or (tipo in ('saldo_inicial', 'descuento_sueldo') and origen is null)),
  constraint persona_cuenta_anulacion_chk check (anulado_en is null or (anulado_por is not null and anulado_motivo is not null))
);

-- Un solo saldo inicial vigente por persona (si se cargó mal, se anula y se carga de nuevo).
create unique index if not exists persona_cuenta_saldo_inicial_uni on public.persona_cuenta (persona_id) where tipo = 'saldo_inicial' and anulado_en is null;
create index if not exists persona_cuenta_persona_idx on public.persona_cuenta (persona_id, fecha desc) where anulado_en is null;
create index if not exists persona_cuenta_origen_idx on public.persona_cuenta (origen, fecha) where anulado_en is null and origen is not null;

comment on table  public.persona_cuenta is 'Cuenta corriente de una persona con la empresa: saldo inicial, adelantos, reposiciones y descuentos de sueldo. debe = inicial + adelantos − reposiciones − descuentos.';
comment on column public.persona_cuenta.fecha is 'Saldo inicial: el saldo es el de al comenzar ese día. Resto: fecha en que pasó.';
comment on column public.persona_cuenta.origen is 'Adelanto: de dónde salió la plata. Reposición: adónde entró. efectivo_tesoreria y mercadopago mueven esas cuentas; transferencia no. Vacío en saldo inicial y descuento de sueldo.';

-- ── Historial (104…116): acciones nuevas ────────────────────────────────────
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
  'proveedor_ficha',
  'persona_saldo_inicial', 'persona_adelanto', 'persona_reposicion', 'persona_descuento_sueldo', 'persona_movimiento_anulado'));

-- ── Permisos y RLS ──────────────────────────────────────────────────────────
alter table public.persona_cuenta enable row level security;

revoke all on public.persona_cuenta from anon, authenticated;
grant select on public.persona_cuenta to authenticated;

drop policy if exists "persona_cuenta_select_admin" on public.persona_cuenta;
create policy "persona_cuenta_select_admin" on public.persona_cuenta for select to authenticated
  using ((select is_admin()));

-- ── Verificación (correr después) ───────────────────────────────────────────
-- select count(*) from public.persona_cuenta;                                                 -- 0
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'tesoreria_historial_accion_check';   -- incluye 'persona_adelanto'
-- select has_table_privilege('authenticated', 'public.persona_cuenta', 'insert'),
--        has_table_privilege('anon', 'public.persona_cuenta', 'select');                       -- false, false
--
-- Reversión (borra los movimientos cargados; el historial conserva el rastro):
--   drop table if exists public.persona_cuenta;
--   -- y volver el check del historial a las 23 acciones de la 116 solo si no hay filas con las acciones nuevas.
