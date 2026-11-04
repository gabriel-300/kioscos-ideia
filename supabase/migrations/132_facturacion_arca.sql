-- ============================================================================
-- 132 · Facturación electrónica con ARCA (ex AFIP)
--
-- La SAS es Responsable Inscripto: factura B a consumidor final (código 6) y
-- nota de crédito B (código 8) cuando se anula una venta ya facturada.
--
-- Regla de negocio (decisión del dueño, 2026-11-03):
--   · Todo lo que se cobra por medios digitales (billetera/MP, tarjeta, QR,
--     transferencia) se factura SIEMPRE, de forma automática.
--   · El efectivo NO se factura, salvo que el cliente pida el comprobante:
--     entonces se emite a mano desde la venta.
--
-- Aditiva y sin riesgo: cada sucursal arranca con arca_modo = 'desactivado'
-- (no se factura nada) hasta que un admin la configure.
--
-- Qué NO toca: cerrar_caja, stock, precios, medios de pago. El precio del
-- sistema es FINAL (IVA incluido): el neto y el IVA se calculan hacia atrás.
-- ============================================================================

-- ── 1. Alícuota de IVA por producto ─────────────────────────────────────────
-- 21 por defecto. 10.5 y 0 (exento) se marcan a mano, solo si el contador lo
-- indica. 27 existe en ARCA pero no aplica a estos productos.
alter table public.products
  add column if not exists alicuota_iva numeric(4,1) not null default 21;

alter table public.products drop constraint if exists products_alicuota_iva_chk;
alter table public.products
  add constraint products_alicuota_iva_chk check (alicuota_iva in (0, 10.5, 21, 27));

-- ── 2. Emisores (a nombre de quién se factura) ──────────────────────────────
-- Un CUIT por emisor. IDEIA/ALS S.A.S. es el principal; un local independiente
-- (ej. Bencivenga) puede tener el suyo. El certificado es uno solo, de la
-- plataforma (secrets del Worker); cada CUIT se autoriza en ARCA (WSASS).
create table if not exists public.arca_emisores (
  id            uuid primary key default gen_random_uuid(),
  cuit          text not null check (cuit ~ '^[0-9]{11}$'),
  razon_social  text not null,
  ambiente      text not null default 'homologacion' check (ambiente in ('homologacion','produccion')),
  -- Datos que lleva impreso el comprobante (el emisor es Responsable Inscripto).
  domicilio     text,
  ingresos_brutos text,
  inicio_actividades date,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (cuit, ambiente)
);

-- ── 3. Configuración por sucursal ───────────────────────────────────────────
--   desactivado → no se factura nada (estado inicial)
--   digital     → se factura sola toda venta con algún cobro digital; el
--                 efectivo solo con el botón "Emitir comprobante"
alter table public.sucursales
  add column if not exists arca_modo text not null default 'desactivado'
    check (arca_modo in ('desactivado','digital')),
  add column if not exists arca_emisor_id uuid references public.arca_emisores(id) on delete restrict,
  add column if not exists arca_punto_venta integer check (arca_punto_venta is null or arca_punto_venta between 1 and 99998);

-- No se puede activar sin emisor ni punto de venta.
alter table public.sucursales drop constraint if exists sucursales_arca_completa_chk;
alter table public.sucursales
  add constraint sucursales_arca_completa_chk
  check (arca_modo = 'desactivado' or (arca_emisor_id is not null and arca_punto_venta is not null));

-- ── 4. Ticket de acceso (WSAA) ──────────────────────────────────────────────
-- ARCA entrega un token+sign que dura ~12 h y NO deja pedir otro mientras el
-- anterior sirve ("ya posee un TA válido"). Se guarda acá para que todas las
-- instancias del Worker lo compartan. Solo lo toca el servidor (service role):
-- RLS activada y sin ninguna policy.
create table if not exists public.arca_tickets (
  ambiente    text primary key check (ambiente in ('homologacion','produccion')),
  token       text not null,
  sign        text not null,
  expira_en   timestamptz not null,
  updated_at  timestamptz not null default now()
);
alter table public.arca_tickets enable row level security;

-- ── 5. Comprobantes ─────────────────────────────────────────────────────────
-- Una fila por (venta, tipo). Se crea en 'pendiente' ANTES de hablar con ARCA:
-- el índice único hace de candado contra la doble emisión de la misma venta.
-- Si ARCA falla queda en 'error' o 'pendiente' y se reintenta sobre la MISMA fila.
create table if not exists public.comprobantes_arca (
  id                 uuid primary key default gen_random_uuid(),
  movimiento_id      uuid not null references public.movimientos(id) on delete restrict,
  sucursal_id        uuid not null references public.sucursales(id) on delete restrict,
  emisor_id          uuid not null references public.arca_emisores(id) on delete restrict,
  ambiente           text not null check (ambiente in ('homologacion','produccion')),
  cbte_tipo          integer not null check (cbte_tipo in (6, 8)),   -- 6 = Factura B, 8 = Nota de crédito B
  punto_venta        integer not null,
  numero             bigint,
  -- Número que se le pidió a ARCA en el último intento. Si el intento se cortó
  -- por timeout, ARCA pudo haberlo autorizado igual: antes de reintentar se
  -- consulta ESE número y, si ya existe, se adopta su CAE (evita facturar dos veces).
  numero_intentado   bigint,
  fecha              date not null,
  doc_tipo           integer not null default 99,                    -- 99 consumidor final, 96 DNI, 80 CUIT
  doc_nro            text not null default '0',
  imp_total          numeric(14,2) not null,
  imp_neto           numeric(14,2) not null,
  imp_iva            numeric(14,2) not null,
  iva                jsonb not null,                                 -- [{alicuota, base, importe}]
  origen             text not null check (origen in ('automatico','manual','anulacion')),
  estado             text not null default 'pendiente' check (estado in ('pendiente','emitido','error')),
  cae                text,
  cae_vto            date,
  comprobante_asociado_id uuid references public.comprobantes_arca(id),   -- la factura que anula una NC
  error              text,
  intentos           integer not null default 0,
  tomado_en          timestamptz,                                    -- candado de reintento (2 min)
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  emitido_en         timestamptz,
  check (estado <> 'emitido' or (cae is not null and numero is not null)),
  check (cbte_tipo <> 8 or comprobante_asociado_id is not null)
);

create unique index if not exists comprobantes_arca_venta_tipo_uidx
  on public.comprobantes_arca (movimiento_id, cbte_tipo);
-- ARCA ya impide repetir un número; esto lo impide también acá.
create unique index if not exists comprobantes_arca_numero_uidx
  on public.comprobantes_arca (emisor_id, ambiente, punto_venta, cbte_tipo, numero)
  where numero is not null;
create index if not exists comprobantes_arca_pendientes_idx
  on public.comprobantes_arca (created_at) where estado <> 'emitido';
create index if not exists comprobantes_arca_sucursal_fecha_idx
  on public.comprobantes_arca (sucursal_id, fecha desc);

alter table public.comprobantes_arca enable row level security;
alter table public.arca_emisores     enable row level security;

-- Lectura: admin, o quien tiene acceso a esa sucursal (reusa puede_ver_dueno,
-- migración 131). Escritura: solo el servidor (service role), sin policy.
drop policy if exists comprobantes_arca_select on public.comprobantes_arca;
create policy comprobantes_arca_select on public.comprobantes_arca
  for select to authenticated
  using ((select puede_ver_dueno(sucursal_id)));

drop policy if exists arca_emisores_select on public.arca_emisores;
create policy arca_emisores_select on public.arca_emisores
  for select to authenticated
  using ((select is_admin()));
