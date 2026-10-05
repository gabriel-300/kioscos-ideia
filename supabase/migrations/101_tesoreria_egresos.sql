-- 101: Tesorería unificada, paso 1 (base). Un solo registro de egresos, cargado por un administrativo.
--
-- Contexto: el kiosco carga ventas, caja y la mercadería que ingresa (para el stock); la contabilidad la carga
-- un administrativo desde Tesorería, mirando la factura o el remito real (el personal del kiosco carga mal los
-- importes). Hay compras con factura y sin factura: el gasto se registra igual en los dos casos.
--
-- Qué agrega (todo aditivo: no borra, no renombra, no toca cerrar_caja ni la fórmula de `diferencia`):
--   * profiles.es_administrativo        quién carga en Tesorería (hoy Damián; mañana puede ser otra persona
--                                       sin tocar código, igual que es_socio).
--   * sucursales.entra_en_tesoreria     qué locales entran (Villa Sarita queda afuera: es consignación).
--   * tesoreria_config                  una sola fila: desde qué fecha rige Tesorería y el efectivo inicial.
--   * egresos                           el registro único (reemplaza a gastos, pagos_proveedor y retiros de socio
--                                       para lo nuevo; esas tablas NO se tocan y quedan como histórico).
--   * retiros_caja.egreso_id y movimientos.egreso_id   vacío = "todavía sin registrar en Tesorería". De ahí sale
--                                       la bandeja "Para registrar". El retiro de caja NO es un gasto: es plata que
--                                       sale del cajón; el gasto es el egreso al que el administrativo lo asigna.
--   * bucket privado `tesoreria`        comprobantes (foto o PDF, hasta 1 MB, mismo tope que product-images).
--
-- Quién escribe: solo el servidor con service_role (Server Actions que chequean el rol). `authenticated` solo
-- puede leer, y solo si es admin. Las policies siguen el estilo del repo: llamadas envueltas en (select ...).
--
-- Orden de despliegue: el código tolera que esta migración no esté aplicada (muestra "Falta aplicar la 101").
-- Idempotente. Correr a mano en el SQL Editor de Supabase.

-- ── Quién carga y qué locales entran ───────────────────────────────────────
alter table public.profiles
  add column if not exists es_administrativo boolean not null default false;

comment on column public.profiles.es_administrativo is
  'Carga los egresos de Tesorería. Ortogonal al rol y a es_socio. Lo marca un admin en Staff.';

alter table public.sucursales
  add column if not exists entra_en_tesoreria boolean not null default true;

comment on column public.sucursales.entra_en_tesoreria is
  'false = el local no se ve en Tesorería (Villa Sarita: consignación, el concesionario es el dueño económico).';

update public.sucursales set entra_en_tesoreria = false where nombre = 'Villa Sarita';

-- ── Configuración (una sola fila) ──────────────────────────────────────────
create table if not exists public.tesoreria_config (
  id               boolean primary key default true check (id),   -- check (id): solo puede existir una fila
  fecha_inicio     date    not null,
  efectivo_inicial numeric not null default 0 check (efectivo_inicial >= 0),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);

comment on table  public.tesoreria_config is 'Una sola fila. fecha_inicio: lo anterior no se pide registrar en la bandeja "Para registrar". efectivo_inicial: efectivo de Tesorería al arrancar.';

insert into public.tesoreria_config (id, fecha_inicio) values (true, '2026-10-01')
on conflict (id) do nothing;

-- ── Egresos ────────────────────────────────────────────────────────────────
create table if not exists public.egresos (
  id                 uuid primary key default gen_random_uuid(),
  fecha              date    not null,
  monto              numeric not null check (monto > 0),
  sucursal_id        uuid references public.sucursales(id) on delete restrict,  -- null = gasto general
  categoria          text    not null check (categoria in ('mercaderia', 'sueldos', 'alquiler', 'servicios', 'retiro_socio', 'otro')),
  proveedor_id       uuid references public.proveedores(id) on delete restrict,
  descripcion        text    not null check (length(btrim(descripcion)) > 0),   -- a quién / qué se pagó
  comprobante        text    not null check (comprobante in ('con', 'sin')),
  comprobante_numero text,
  comprobante_path   text,                                                      -- archivo en el bucket privado `tesoreria`
  origen             text    not null check (origen in ('retiro_caja', 'efectivo_tesoreria', 'transferencia', 'mercadopago')),
  gasto_fijo_id      uuid references public.gastos_fijos(id) on delete set null,
  nota               text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz,
  constraint egresos_numero_solo_con_comprobante check (comprobante = 'con' or comprobante_numero is null)
);

create index if not exists egresos_fecha_idx        on public.egresos (fecha desc);
create index if not exists egresos_sucursal_idx     on public.egresos (sucursal_id);
create index if not exists egresos_proveedor_idx    on public.egresos (proveedor_id);
create index if not exists egresos_gasto_fijo_idx   on public.egresos (gasto_fijo_id) where gasto_fijo_id is not null;

comment on table  public.egresos is 'Registro único de egresos de Tesorería (con o sin factura). Lo carga un administrativo; escribe solo el servidor.';
comment on column public.egresos.comprobante is 'con = tiene factura/comprobante; sin = compra sin comprobante. El gasto cuenta igual.';
comment on column public.egresos.origen is 'De dónde salió la plata: retiro_caja (cajón de un kiosco), efectivo_tesoreria, transferencia o mercadopago.';
comment on column public.egresos.categoria is 'retiro_socio no es un gasto operativo: los informes lo separan para no distorsionar el resultado.';

-- ── Vínculo "ya registrado en Tesorería" ───────────────────────────────────
alter table public.retiros_caja
  add column if not exists egreso_id uuid references public.egresos(id) on delete set null;

alter table public.movimientos
  add column if not exists egreso_id uuid references public.egresos(id) on delete set null;

-- Índices parciales: la bandeja solo mira lo que todavía no tiene egreso.
create index if not exists retiros_caja_sin_egreso_idx
  on public.retiros_caja (sucursal_id, fecha) where egreso_id is null;
create index if not exists movimientos_entrega_sin_egreso_idx
  on public.movimientos (sucursal_id, fecha) where tipo = 'entrega' and egreso_id is null;
create index if not exists movimientos_egreso_idx
  on public.movimientos (egreso_id) where egreso_id is not null;
create index if not exists retiros_caja_egreso_idx
  on public.retiros_caja (egreso_id) where egreso_id is not null;

comment on column public.retiros_caja.egreso_id is 'Egreso de Tesorería al que se imputó este retiro. Vacío = pendiente de registrar.';
comment on column public.movimientos.egreso_id  is 'Solo entregas: egreso (compra) de Tesorería al que pertenece. Vacío = pendiente de registrar.';

-- ── Permisos y RLS ─────────────────────────────────────────────────────────
alter table public.egresos          enable row level security;
alter table public.tesoreria_config enable row level security;

revoke all on public.egresos          from anon, authenticated;
revoke all on public.tesoreria_config from anon, authenticated;
grant select on public.egresos          to authenticated;
grant select on public.tesoreria_config to authenticated;

drop policy if exists "egresos_select_admin" on public.egresos;
create policy "egresos_select_admin" on public.egresos for select to authenticated
  using ((select is_admin()));

drop policy if exists "tesoreria_config_select_admin" on public.tesoreria_config;
create policy "tesoreria_config_select_admin" on public.tesoreria_config for select to authenticated
  using ((select is_admin()));

-- ── Bucket privado de comprobantes ─────────────────────────────────────────
-- Privado a propósito (el de `remitos` es público). Sin policies en storage.objects: ni subir ni leer desde el
-- navegador con la sesión; el servidor firma una URL de subida y una de lectura de corta duración.
-- Tope de 1 MB hecho cumplir por la base (el navegador ya reduce las fotos antes de subir).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tesoreria', 'tesoreria', false, 1048576,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select column_name from information_schema.columns where table_schema = 'public'
--  and ((table_name = 'profiles' and column_name = 'es_administrativo')
--    or (table_name = 'sucursales' and column_name = 'entra_en_tesoreria')
--    or (table_name in ('retiros_caja', 'movimientos') and column_name = 'egreso_id'));        -- 4 filas
-- select nombre, entra_en_tesoreria from public.sucursales order by nombre;                     -- solo Villa Sarita en false
-- select * from public.tesoreria_config;                                                         -- 1 fila, 2026-10-01
-- select id, public, file_size_limit from storage.buckets where id = 'tesoreria';               -- public = false, 1048576
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'egresos' and grantee in ('anon', 'authenticated');                       -- solo authenticated / SELECT
--
-- Reversión (solo si hiciera falta; ninguna tabla vieja se modificó salvo las dos columnas egreso_id):
--   alter table public.movimientos  drop column if exists egreso_id;
--   alter table public.retiros_caja drop column if exists egreso_id;
--   drop table if exists public.egresos;  drop table if exists public.tesoreria_config;
--   alter table public.sucursales drop column if exists entra_en_tesoreria;
--   alter table public.profiles   drop column if exists es_administrativo;
--   delete from storage.buckets where id = 'tesoreria';   -- vaciarlo antes
