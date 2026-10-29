-- 130: ficha (legajo) del personal y de los socios: datos personales, laborales y de pago.
--
-- Contexto: de cada persona el sistema sabía solo nombre, teléfono, documento, kiosco y rol. Para liquidar sueldos, llevar las cuentas
-- corrientes y el alta registrada (Iris y Matías, media jornada) hace falta un legajo completo. Se guarda en una tabla aparte (1 a 1 con
-- profiles) y no en profiles, que tiene columnas protegidas y se lee desde los kioscos: estos datos son sensibles (CUIL, CBU, domicilio).
-- Todo es opcional salvo la persona; nada bloquea vender, cargar ni pagar. Un cambio queda en el Historial de Tesorería con antes y después.
--
-- Escribe solo el servidor (service_role); lo lee un admin. Los documentos escaneados (DNI, alta, contrato) quedan para una etapa siguiente.
-- Orden de despliegue: la pantalla de la ficha avisa si la migración no está aplicada; el resto del sistema no la usa.
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 129.

create table if not exists public.personal_ficha (
  persona_id        uuid primary key references public.profiles(id) on delete cascade,
  -- Datos personales
  legajo            text,
  cuil              text,
  fecha_nacimiento  date,
  estado_civil      text,
  nacionalidad      text,
  domicilio         text,
  localidad         text,
  email_personal    text,
  emergencia_nombre   text,
  emergencia_vinculo  text,
  emergencia_telefono text,
  -- Datos laborales
  puesto            text,
  fecha_ingreso     date,
  fecha_egreso      date,
  motivo_egreso     text,
  registro          text,           -- registrado (en blanco) o no_registrado
  fecha_alta_registro date,
  jornada           text,
  horas_semanales   numeric(4,1),
  turno_habitual    text,
  convenio          text,
  categoria         text,
  obra_social       text,
  -- Pago
  sueldo_acordado   numeric(14,2),  -- lo que cobra en total por mes
  sueldo_en_recibo  numeric(14,2),  -- la parte que figura en el recibo (si está registrado)
  dia_pago          smallint,
  forma_pago        text,
  banco             text,
  cbu_alias         text,
  titular_cuenta    text,
  tope_descuento_pct numeric(5,2),  -- tope de lo que se le puede descontar por mes, en % del sueldo
  notas             text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz
);

alter table public.personal_ficha drop constraint if exists personal_ficha_cuil_chk;
alter table public.personal_ficha add constraint personal_ficha_cuil_chk check (cuil is null or cuil ~ '^[0-9]{11}$');
alter table public.personal_ficha drop constraint if exists personal_ficha_estado_civil_chk;
alter table public.personal_ficha add constraint personal_ficha_estado_civil_chk
  check (estado_civil is null or estado_civil in ('soltero', 'casado', 'union_convivencial', 'divorciado', 'viudo'));
alter table public.personal_ficha drop constraint if exists personal_ficha_registro_chk;
alter table public.personal_ficha add constraint personal_ficha_registro_chk check (registro is null or registro in ('registrado', 'no_registrado'));
alter table public.personal_ficha drop constraint if exists personal_ficha_jornada_chk;
alter table public.personal_ficha add constraint personal_ficha_jornada_chk check (jornada is null or jornada in ('completa', 'media', 'otra'));
alter table public.personal_ficha drop constraint if exists personal_ficha_horas_chk;
alter table public.personal_ficha add constraint personal_ficha_horas_chk check (horas_semanales is null or (horas_semanales > 0 and horas_semanales <= 60));
alter table public.personal_ficha drop constraint if exists personal_ficha_forma_pago_chk;
alter table public.personal_ficha add constraint personal_ficha_forma_pago_chk
  check (forma_pago is null or forma_pago in ('efectivo_tesoreria', 'transferencia', 'mercadopago'));
alter table public.personal_ficha drop constraint if exists personal_ficha_sueldos_chk;
alter table public.personal_ficha add constraint personal_ficha_sueldos_chk
  check ((sueldo_acordado is null or sueldo_acordado >= 0) and (sueldo_en_recibo is null or sueldo_en_recibo >= 0));
alter table public.personal_ficha drop constraint if exists personal_ficha_dia_pago_chk;
alter table public.personal_ficha add constraint personal_ficha_dia_pago_chk check (dia_pago is null or (dia_pago between 1 and 31));
alter table public.personal_ficha drop constraint if exists personal_ficha_tope_chk;
alter table public.personal_ficha add constraint personal_ficha_tope_chk check (tope_descuento_pct is null or (tope_descuento_pct >= 0 and tope_descuento_pct <= 100));
alter table public.personal_ficha drop constraint if exists personal_ficha_fechas_chk;
alter table public.personal_ficha add constraint personal_ficha_fechas_chk check (fecha_egreso is null or fecha_ingreso is null or fecha_egreso >= fecha_ingreso);

-- Único cuando está cargado (dos personas no pueden tener el mismo legajo ni el mismo CUIL).
create unique index if not exists personal_ficha_legajo_uni on public.personal_ficha (lower(btrim(legajo))) where legajo is not null;
create unique index if not exists personal_ficha_cuil_uni on public.personal_ficha (cuil) where cuil is not null;

comment on table  public.personal_ficha is 'Legajo de una persona (empleado o socio): datos personales, laborales y de pago. 1 a 1 con profiles. Sensible: solo lo lee un admin.';
comment on column public.personal_ficha.registro is 'registrado (en blanco) o no_registrado. Opcional.';
comment on column public.personal_ficha.sueldo_en_recibo is 'Parte del sueldo que figura en el recibo, si la persona está registrada. Opcional.';
comment on column public.personal_ficha.tope_descuento_pct is 'Tope mensual de descuentos (adelantos, mercadería) en % del sueldo acordado. Opcional.';

-- ── Historial: acción nueva ─────────────────────────────────────────────────
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
  'persona_saldo_inicial', 'persona_adelanto', 'persona_reposicion', 'persona_descuento_sueldo', 'persona_movimiento_anulado',
  'persona_ficha'));

-- ── Permisos y RLS ──────────────────────────────────────────────────────────
alter table public.personal_ficha enable row level security;

revoke all on public.personal_ficha from anon, authenticated;
grant select on public.personal_ficha to authenticated;

drop policy if exists "personal_ficha_select_admin" on public.personal_ficha;
create policy "personal_ficha_select_admin" on public.personal_ficha for select to authenticated
  using ((select is_admin()));

-- ── Verificación (correr después) ───────────────────────────────────────────
-- select count(*) from public.personal_ficha;                                                  -- 0
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'tesoreria_historial_accion_check';   -- incluye 'persona_ficha'
-- select has_table_privilege('authenticated', 'public.personal_ficha', 'insert'),
--        has_table_privilege('anon', 'public.personal_ficha', 'select');                        -- false, false
--
-- Reversión (borra las fichas cargadas; el historial conserva el rastro):
--   drop table if exists public.personal_ficha;
--   -- y volver el check del historial a las 28 acciones de la 129 solo si no hay filas con 'persona_ficha'.
