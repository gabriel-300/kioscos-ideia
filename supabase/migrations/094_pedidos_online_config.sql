-- Rediseño del catálogo público: configuración de pedidos online por
-- sucursal, zonas de envío con costo, y los campos que le faltaban a
-- "pedidos" para efectivo en la puerta / Mercado Pago / envío por zona.
--
-- Correr en Supabase → SQL Editor → New query → Run (igual que 091-093).

-- ── 1. Configuración por sucursal ─────────────────────────────────────
alter table public.sucursales
  add column if not exists pedidos_online_habilitado boolean not null default false,
  add column if not exists delivery_habilitado       boolean not null default false,
  add column if not exists retiro_habilitado         boolean not null default true,
  add column if not exists pedido_minimo_envio       numeric(12,2) not null default 0,
  add column if not exists retiro_eta_min            integer not null default 15,
  add column if not exists retiro_eta_max            integer not null default 20,
  add column if not exists whatsapp_pedidos          text,
  -- [{ "dia": 0-6 (0=domingo), "abre": "08:00", "cierra": "00:30" }]
  -- "cierra" puede ser menor que "abre" (cruza la medianoche). null = sin
  -- horario cargado (se considera siempre abierto).
  add column if not exists horario_pedidos           jsonb;

-- Las sucursales que ya tenían el catálogo público andando (las que
-- cobran con Mercado Pago) siguen habilitadas, para no cortar nada.
update public.sucursales
   set pedidos_online_habilitado = true
 where mercadopago_pos_id is not null;

-- ── 2. Zonas de envío (sin datos sembrados: se cargan desde el admin) ─
create table if not exists public.zonas_entrega (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  uuid not null references public.sucursales(id) on delete cascade,
  nombre       text not null,
  costo        numeric(12,2) not null default 0 check (costo >= 0),
  eta_min      integer not null default 30 check (eta_min >= 0),
  eta_max      integer not null default 45,
  orden        integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint zonas_entrega_eta_check check (eta_max >= eta_min)
);

create index if not exists zonas_entrega_sucursal_idx
  on public.zonas_entrega (sucursal_id, is_active, orden);

alter table public.zonas_entrega enable row level security;

create policy "admin_all_zonas_entrega" on public.zonas_entrega
  for all to authenticated using (is_admin()) with check (is_admin());

create policy "staff_select_zonas_entrega" on public.zonas_entrega
  for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

-- ── 3. Campos nuevos en pedidos ───────────────────────────────────────
alter table public.pedidos
  add column if not exists costo_envio          numeric(12,2) not null default 0,
  add column if not exists zona_entrega_id      uuid references public.zonas_entrega(id) on delete set null,
  add column if not exists zona_nombre          text,
  add column if not exists direccion_referencia text,
  add column if not exists pago_con             numeric(12,2),
  add column if not exists eta_min              integer,
  add column if not exists eta_max              integer,
  add column if not exists numero               bigint generated always as identity;

create unique index if not exists pedidos_numero_idx on public.pedidos (numero);

-- ── 4. Estados y medios de pago nuevos ────────────────────────────────
-- Se busca el nombre real de los constraints en pg_constraint en vez de
-- asumir el autogenerado por Postgres.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.pedidos'::regclass
       and contype = 'c'
       and (
            (pg_get_constraintdef(oid) ilike '%estado%' and pg_get_constraintdef(oid) ilike '%carrito%')
            or pg_get_constraintdef(oid) ilike '%medio_pago%'
       )
  loop
    execute format('alter table public.pedidos drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.pedidos
  add constraint pedidos_estado_check check (estado in (
    'carrito', 'pendiente_pago', 'confirmado', 'pagado',
    'en_preparacion', 'listo_retiro', 'en_reparto',
    'entregado', 'cancelado', 'expirado'
  ));

alter table public.pedidos
  add constraint pedidos_medio_pago_check check (
    medio_pago is null
    or medio_pago in ('mercadopago_qr', 'mercadopago_link', 'efectivo')
  );
