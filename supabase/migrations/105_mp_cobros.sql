-- 105: Tesorería, importación de los cobros de Mercado Pago (reporte Excel del panel de MP).
--
-- Contexto: el sistema sabe que una venta fue "billetera" o "transferencia" pero no qué cobró realmente Mercado Pago ni cuánto
-- cobró de comisión. El administrativo baja el reporte de COBROS del panel de MP y lo sube a Tesorería; cada fila se guarda acá.
-- Sirve para: (1) saber cuánto entró por MP, cuánto fue comisión y cuánto queda por liberar, por local; (2) cruzar cada cobro
-- con la orden de QR del sistema (por nº de operación o referencia) y ver lo que MP cobró y el sistema no registró o al revés;
-- (3) dejar a la vista lo que NO es una venta de caja (fondeos desde un banco, movimientos internos) para que lo clasifique una
-- persona, sin suponer qué es.
--
-- Del archivo se guardan solo las columnas necesarias; nombres, mails y documentos de los clientes no se guardan (el navegador
-- ni siquiera los envía). Escribe solo el servidor (service_role); lo lee un admin. No toca ninguna tabla existente salvo
-- ampliar la lista de acciones permitidas del historial (104).
--
-- Orden de despliegue: la solapa «Mercado Pago» de Tesorería muestra un aviso hasta que se aplique.
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 104.

-- ── Cada archivo que se sube (para saber qué días están cubiertos) ──────────
create table if not exists public.mp_importaciones (
  id             uuid primary key default gen_random_uuid(),
  creado_en      timestamptz not null default now(),
  importado_por  uuid references auth.users(id),
  archivo        text,
  desde          date not null,            -- primer día de cobros del archivo (hora argentina)
  hasta          date not null,
  filas          integer not null,         -- cobros que traía el archivo
  nuevas         integer not null,         -- las que no estaban cargadas
  actualizadas   integer not null          -- las que ya estaban (se refrescó estado e importes)
);

-- ── Cada cobro, una fila por número de operación de MP ──────────────────────
create table if not exists public.mp_cobros (
  operation_id        text primary key,                       -- "Número de operación de Mercado Pago"
  sucursal_id         uuid references public.sucursales(id),  -- se deduce de la caja; null si no se pudo
  caja_externa        text,                                   -- external_id de la caja de MP (sucursales.mercadopago_pos_id)
  fecha_cobro         timestamptz not null,
  fecha_acreditacion  timestamptz,
  fecha_liberacion    timestamptz,                            -- cuándo queda disponible; posterior a hoy = «a liberar»
  monto_bruto         numeric(14,2) not null,
  tarifa              numeric(14,2) not null default 0,       -- comisión de MP, positiva
  monto_neto          numeric(14,2) not null,
  monto_devuelto      numeric(14,2) not null default 0,
  estado              text not null,                          -- approved, refunded, charged_back…
  estado_detalle      text,
  tipo_operacion      text not null,                          -- regular_payment, account_fund, partition_transfer…
  medio_pago          text,
  descripcion         text,
  external_reference  text,                                   -- = mercadopago_qr_orders.external_reference
  clase               text not null check (clase in ('cobro', 'a_clasificar')),
  clasificacion       text check (clasificacion in ('transferencia_propia', 'aporte_socio', 'otro_ingreso', 'no_es_ingreso')),
  clasificacion_nota  text,
  clasificado_por     uuid references auth.users(id),
  clasificado_en      timestamptz,
  importacion_id      uuid references public.mp_importaciones(id),
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

create index if not exists mp_cobros_fecha_idx        on public.mp_cobros (fecha_cobro desc);
create index if not exists mp_cobros_sucursal_idx     on public.mp_cobros (sucursal_id, fecha_cobro desc);
create index if not exists mp_cobros_referencia_idx   on public.mp_cobros (external_reference) where external_reference is not null;
create index if not exists mp_cobros_sin_clasificar_idx on public.mp_cobros (fecha_cobro desc) where clase = 'a_clasificar' and clasificacion is null;

comment on table  public.mp_cobros is 'Cobros del reporte de Mercado Pago importado por Tesorería. Una fila por nº de operación; reimportar actualiza estado e importes y no pisa la clasificación.';
comment on column public.mp_cobros.clase is 'cobro = venta por QR de una caja conocida; a_clasificar = fondeo, movimiento interno u operación sin local: lo clasifica una persona.';
comment on column public.mp_cobros.clasificacion is 'Qué es, según quien lo clasificó. null = todavía sin clasificar.';
comment on column public.mp_cobros.fecha_liberacion is 'Cuándo MP libera la plata. Si es posterior a hoy, el neto está «a liberar» y no es disponible.';

-- ── Historial (104): dos acciones nuevas ────────────────────────────────────
alter table public.tesoreria_historial drop constraint if exists tesoreria_historial_accion_check;
alter table public.tesoreria_historial add constraint tesoreria_historial_accion_check check (accion in (
  'egreso_creado', 'egreso_pagado', 'egreso_anulado',
  'entrega_descartada', 'entrega_restaurada',
  'efectivo_inicial_cambiado', 'permiso_cambiado',
  'mp_cobros_importados', 'mp_cobro_clasificado'));

-- ── Permisos y RLS ──────────────────────────────────────────────────────────
alter table public.mp_importaciones enable row level security;
alter table public.mp_cobros        enable row level security;

revoke all on public.mp_importaciones from anon, authenticated;
revoke all on public.mp_cobros        from anon, authenticated;
grant select on public.mp_importaciones to authenticated;
grant select on public.mp_cobros        to authenticated;

drop policy if exists "mp_importaciones_select_admin" on public.mp_importaciones;
create policy "mp_importaciones_select_admin" on public.mp_importaciones for select to authenticated
  using ((select is_admin()));

drop policy if exists "mp_cobros_select_admin" on public.mp_cobros;
create policy "mp_cobros_select_admin" on public.mp_cobros for select to authenticated
  using ((select is_admin()));

-- ── Verificación (correr después) ───────────────────────────────────────────
-- select count(*) from public.mp_cobros;                                                    -- 0
-- select conname from pg_constraint where conrelid = 'public.tesoreria_historial'::regclass and contype = 'c';
--   -- tesoreria_historial_accion_check (con las 9 acciones)
-- select has_table_privilege('authenticated', 'public.mp_cobros', 'insert'),
--        has_table_privilege('anon', 'public.mp_cobros', 'select');                          -- false, false
--
-- Reversión (borra lo importado; el historial conserva el rastro de las importaciones):
--   drop table if exists public.mp_cobros;
--   drop table if exists public.mp_importaciones;
--   -- y volver el check del historial a las 7 acciones de la 104 solo si no hay filas con las acciones nuevas.
