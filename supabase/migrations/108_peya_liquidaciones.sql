-- 108: Tesorería, liquidaciones semanales de PedidosYa (importadas del Portal de PedidosYa, sin API).
--
-- Contexto: PedidosYa no da API. Una persona baja del portal, una vez por semana, el CSV de pedidos y el Excel del estado de
-- cuenta (y mira el PDF) y los sube a Tesorería. El sistema:
--   * guarda el desglose por pedido (venta, comisión, cargo por pago en línea, cargo Plus, impuesto, ingreso estimado),
--   * guarda los conceptos de la semana que no vienen por pedido (publicidad, IVA, retención SIRTAC, reintegros, ajustes),
--   * verifica que el neto calculado sea igual al «Total liquidado» del estado de cuenta (si no, no se confirma),
--   * cruza cada pedido con la venta ya registrada en el kiosco,
--   * dice cuándo se cobra (PedidosYa transfiere cada semana a Mercado Pago) y cuánto, como un «a cobrar».
--
-- Dinero siempre en numeric(14,2); el código calcula en centavos enteros (nunca float). No se guardan datos de clientes: el CSV
-- no los trae. No se asume ninguna regla que no esté en los archivos (el efectivo queda «pendiente de validar»).
--
-- Escribe solo el servidor (service_role); lo lee un admin. Amplía la lista de acciones del historial (104/105/106/107) y agrega un
-- depósito privado para guardar los archivos originales (auditoría: qué se subió, quién y cuándo).
--
-- También deja asignada la tienda 626966 «Angiru Enminutas» de PedidosYa al local Parque de las Fiestas (confirmado por el
-- administrador: PedidosYa hoy solo funciona en el Parque). Si hubiera otra tienda se asigna desde la pantalla.
--
-- Orden de despliegue: la solapa «PedidosYa» muestra un aviso hasta que se aplique. Idempotente. Después de la 107.

-- ── Liquidaciones (una por tienda y período) ────────────────────────────────
create table if not exists public.peya_liquidaciones (
  id                          uuid primary key default gen_random_uuid(),
  tienda_id                   text not null,                         -- «ID de tienda» de PedidosYa
  sucursal_id                 uuid references public.sucursales(id), -- local del sistema (por sucursales.pedidoya_store_id)
  periodo_desde               date not null,
  periodo_hasta               date not null,
  estado                      text not null default 'estimado'
                              check (estado in ('estimado', 'confirmado', 'acreditado', 'conciliado')),

  -- Lo que sale de los pedidos (CSV + Excel)
  pedidos_entregados          integer not null default 0,
  pedidos_cancelados          integer not null default 0,
  ventas_netas                numeric(14,2) not null default 0,   -- Σ «Total parcial» de los entregados
  servicio_ventas             numeric(14,2) not null default 0,   -- Σ «Comisión»
  servicio_pago_linea         numeric(14,2) not null default 0,   -- Σ «Comisión por pago en línea»
  cargo_plus                  numeric(14,2) not null default 0,   -- Σ cargo por pedidos con Plus (en el CSV viene como «Descuento financiado por usted»)
  cargos_cancelacion          numeric(14,2) not null default 0,   -- cancelaciones con IVA, positivo = lo que se descuenta
  impuestos_pedidos           numeric(14,2) not null default 0,   -- Σ «Impuesto» de los pedidos
  ingreso_estimado            numeric(14,2) not null default 0,   -- Σ «Ingreso estimado» (todas las filas, el cancelado va en negativo)

  -- Lo que viene solo del estado de cuenta (PDF o formulario), con el signo con que aparece (descuento = negativo)
  publicidad                  numeric(14,2),
  iva_comisiones              numeric(14,2),                      -- «Impuesto en comisiones - IVA»: incluye el IVA de la publicidad
  retenciones_sirtac          numeric(14,2),
  reintegros                  numeric(14,2),
  ajustes                     numeric(14,2),                      -- «Ajustes de liquidación»
  saldo_anterior              numeric(14,2),                      -- «Saldo pendiente liquidación anterior»
  ajustes_nota                text,

  total_liquidado             numeric(14,2),                      -- el del estado de cuenta: es la verdad de lo que se cobra
  neto_calculado              numeric(14,2),                      -- lo que da la cuenta con los archivos
  diferencia                  numeric(14,2),                      -- neto_calculado − total_liquidado (0 = cierra)

  -- Cuándo se cobra
  fecha_pago_procesado        date,                               -- «el día dd/mm procesamos el pago»
  fecha_pago_estimada         date,                               -- si todavía no hay estado de cuenta: fin del período + el plazo de la última
  fecha_acreditacion_hasta    date,                               -- fecha de pago + 72 hs hábiles (sin feriados)
  fecha_acreditacion_real     date,                               -- la carga el administrativo cuando entra a Mercado Pago
  monto_acreditado            numeric(14,2),
  mp_operation_id             text,                               -- movimiento de Mercado Pago (mp_cobros.operation_id) que lo acreditó
  cuenta_destino              text,                               -- «PSP PEYA terminada en 8313»
  alerta_plazo                text,                               -- si cambió el plazo entre fin de período y pago

  confirmada_por              uuid references auth.users(id),
  confirmada_en               timestamptz,
  created_by                  uuid references auth.users(id),
  created_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users(id),
  updated_at                  timestamptz not null default now(),

  constraint peya_liq_periodo_chk check (periodo_hasta >= periodo_desde),
  constraint peya_liq_unica unique (tienda_id, periodo_desde, periodo_hasta)
);

create index if not exists peya_liq_pago_idx on public.peya_liquidaciones (fecha_pago_procesado desc);
create index if not exists peya_liq_sucursal_idx on public.peya_liquidaciones (sucursal_id, periodo_hasta desc);

-- ── Pedidos (uno por tienda y número de pedido) ─────────────────────────────
create table if not exists public.peya_pedidos (
  id                    uuid primary key default gen_random_uuid(),
  liquidacion_id        uuid not null references public.peya_liquidaciones(id) on delete cascade,
  tienda_id             text not null,
  nro_pedido            text not null,
  estado                text not null,                   -- entregado, cancelado… (tal cual el portal, en minúsculas)
  forma_pago            text,
  fecha_pedido          timestamptz,
  entregado_en          timestamptz,
  cancelado_en          timestamptz,
  motivo_rechazo        text,
  responsable_rechazo   text,
  total_parcial         numeric(14,2) not null default 0,     -- venta bruta
  impuesto              numeric(14,2) not null default 0,
  comision_pago_linea   numeric(14,2) not null default 0,
  cargo_plus            numeric(14,2) not null default 0,
  comision              numeric(14,2) not null default 0,
  gastos_operativos     numeric(14,2) not null default 0,     -- en un cancelado, el cargo por cancelar
  ingreso_estimado      numeric(14,2) not null default 0,
  importe_pago          numeric(14,2) not null default 0,
  monto_adeudado        numeric(14,2) not null default 0,
  efectivo_cobrado      numeric(14,2) not null default 0,     -- «Monto en efectivo ya cobrado por el local»
  metodo_pago           text,                                 -- del Excel: «Método de pago»
  cobrado_por           text,                                 -- del Excel: «Cobrado por»
  articulos             text,
  movimiento_id         uuid references public.movimientos(id) on delete set null,   -- la venta del kiosco con la que se cruzó
  conciliacion          text not null default 'sin_revisar'
                        check (conciliacion in ('conciliado', 'sin_venta', 'importe_distinto', 'efectivo_pendiente', 'sin_revisar', 'no_aplica')),
  diferencia_importe    numeric(14,2),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint peya_pedidos_unico unique (tienda_id, nro_pedido)
);

create index if not exists peya_pedidos_liq_idx on public.peya_pedidos (liquidacion_id);
create index if not exists peya_pedidos_mov_idx on public.peya_pedidos (movimiento_id) where movimiento_id is not null;

-- ── Archivos originales subidos (auditoría) ─────────────────────────────────
create table if not exists public.peya_archivos (
  id              uuid primary key default gen_random_uuid(),
  liquidacion_id  uuid not null references public.peya_liquidaciones(id) on delete cascade,
  tipo            text not null check (tipo in ('csv', 'excel', 'pdf')),
  nombre          text not null,
  path            text not null,                     -- ruta en el depósito privado «peya»
  bytes           integer,
  subido_por      uuid references auth.users(id),
  subido_en       timestamptz not null default now()
);
create index if not exists peya_archivos_liq_idx on public.peya_archivos (liquidacion_id);

comment on table  public.peya_liquidaciones is 'Una liquidación semanal de PedidosYa por tienda. total_liquidado (estado de cuenta) manda; neto_calculado sale de los pedidos y los conceptos de la semana; diferencia debe ser 0 para confirmar.';
comment on table  public.peya_pedidos is 'Un pedido de PedidosYa con su desglose. Clave: (tienda, nº de pedido). movimiento_id es la venta del kiosco con la que se cruzó (por día, importe y hora: el sistema no guarda el nº de pedido).';
comment on column public.peya_pedidos.cargo_plus is 'En el CSV del portal viene en la columna «Descuento financiado por usted» (coincide con «Cargo por Pedidos con Plus» del Excel).';
comment on column public.peya_liquidaciones.iva_comisiones is '«Impuesto en comisiones - IVA» del estado de cuenta: IVA de las comisiones y cargos por pedido (Σ impuesto de los pedidos) más el IVA de la publicidad.';

-- ── Tienda 626966 → Parque de las Fiestas (solo si todavía no tiene una asignada) ──
update public.sucursales set pedidoya_store_id = '626966'
 where nombre = 'Parque de las Fiestas' and pedidoya_store_id is null
   and not exists (select 1 from public.sucursales where pedidoya_store_id = '626966');

-- ── Historial: acciones nuevas (se repiten todas las anteriores) ────────────
alter table public.tesoreria_historial drop constraint if exists tesoreria_historial_accion_check;
alter table public.tesoreria_historial add constraint tesoreria_historial_accion_check check (accion in (
  'egreso_creado', 'egreso_pagado', 'egreso_anulado',
  'entrega_descartada', 'entrega_restaurada',
  'efectivo_inicial_cambiado', 'permiso_cambiado',
  'mp_cobros_importados', 'mp_cobro_clasificado',
  'proveedor_saldo_inicial', 'proveedor_pago', 'proveedor_movimiento_anulado',
  'mp_saldo_inicial', 'mp_retiro', 'mp_movimiento_anulado',
  'peya_liquidacion_importada', 'peya_liquidacion_confirmada', 'peya_acreditacion_registrada', 'peya_conciliacion_manual'));

-- ── Depósito privado de los archivos originales ─────────────────────────────
-- Sin policies en storage.objects: ni subir ni leer desde el navegador con la sesión; el servidor firma una URL de subida y
-- otra de lectura de corta duración. Tope de 2 MB hecho cumplir por la base.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('peya', 'peya', false, 2097152,
        array['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/pdf', 'application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                 'application/pdf', 'application/octet-stream'];

-- ── Permisos y RLS ──────────────────────────────────────────────────────────
alter table public.peya_liquidaciones enable row level security;
alter table public.peya_pedidos       enable row level security;
alter table public.peya_archivos      enable row level security;

revoke all on public.peya_liquidaciones from anon, authenticated;
revoke all on public.peya_pedidos       from anon, authenticated;
revoke all on public.peya_archivos      from anon, authenticated;
grant select on public.peya_liquidaciones to authenticated;
grant select on public.peya_pedidos       to authenticated;
grant select on public.peya_archivos      to authenticated;

drop policy if exists "peya_liquidaciones_select_admin" on public.peya_liquidaciones;
create policy "peya_liquidaciones_select_admin" on public.peya_liquidaciones for select to authenticated using ((select is_admin()));
drop policy if exists "peya_pedidos_select_admin" on public.peya_pedidos;
create policy "peya_pedidos_select_admin" on public.peya_pedidos for select to authenticated using ((select is_admin()));
drop policy if exists "peya_archivos_select_admin" on public.peya_archivos;
create policy "peya_archivos_select_admin" on public.peya_archivos for select to authenticated using ((select is_admin()));

-- ── Verificación (correr después) ───────────────────────────────────────────
-- select count(*) from public.peya_liquidaciones;                                            -- 0
-- select nombre, pedidoya_store_id from public.sucursales where pedidoya_store_id is not null; -- Parque de las Fiestas | 626966
-- select conname from pg_constraint where conrelid = 'public.tesoreria_historial'::regclass and contype = 'c';
--   -- tesoreria_historial_accion_check (con las 19 acciones)
-- select id, public, file_size_limit from storage.buckets where id = 'peya';                 -- peya | false | 2097152
-- select has_table_privilege('authenticated', 'public.peya_liquidaciones', 'insert'),
--        has_table_privilege('anon', 'public.peya_pedidos', 'select');                         -- false, false
--
-- Reversión (borra lo importado; el historial conserva el rastro):
--   drop table if exists public.peya_archivos; drop table if exists public.peya_pedidos; drop table if exists public.peya_liquidaciones;
--   delete from storage.buckets where id = 'peya';   -- solo si está vacío
--   update public.sucursales set pedidoya_store_id = null where pedidoya_store_id = '626966';
--   -- y volver el check del historial a las 15 acciones de la 107 solo si no hay filas con las acciones nuevas.
