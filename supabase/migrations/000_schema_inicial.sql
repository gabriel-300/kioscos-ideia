-- ============================================================
-- SCHEMA INICIAL — Kioscos IDEIA (idempotente)
-- ============================================================

-- ── 1. TIPOS ENUM ──────────────────────────────────────────

do $$ begin
  create type public.user_role as enum (
    'customer_b2c','customer_b2b','repartidor','admin_enminutas','admin_ideaia'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum (
    'pending_payment','payment_review','paid','preparing','ready',
    'in_delivery','shipped','delivered','cancelled','refunded',
    'aprobado','enviado_prod','despachado','en_distribucion'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_channel as enum (
    'b2c_nacional','b2b_mayorista','pedido_ya_local'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.b2b_status as enum (
    'pending','approved','rejected','suspended'
  );
exception when duplicate_object then null; end $$;

-- ── 2. FUNCIÓN is_admin ─────────────────────────────────────

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'encargado'),
    false
  );
$$;

-- ── 3. FUNCIÓN updated_at trigger ──────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 4. TABLA: profiles ──────────────────────────────────────

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  role            public.user_role not null default 'customer_b2c',
  full_name       text,
  phone           text,
  document_type   text,
  document_number text,
  canal           text check (canal in ('dist', 'gastro', 'min')),
  zona_id         uuid,
  b2b_status      text check (b2b_status in ('pendiente', 'activo', 'inactivo')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;

do $$ begin
  create policy "Usuarios ven su propio perfil"
    on public.profiles for select to authenticated
    using (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Usuarios editan su propio perfil"
    on public.profiles for update to authenticated
    using (auth.uid() = id) with check (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins ven todos los perfiles"
    on public.profiles for select to authenticated
    using (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins editan todos los perfiles"
    on public.profiles for update to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── 5. TABLA: categories ────────────────────────────────────

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  image_url   text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.categories enable row level security;

do $$ begin
  create policy "Todos ven categorías activas"
    on public.categories for select using (is_active = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins gestionan categorías"
    on public.categories for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── 6. TABLA: products ──────────────────────────────────────

create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null unique,
  slug              text not null unique,
  name              text not null,
  short_description text,
  description       text,
  category_id       uuid references public.categories(id) on delete set null,
  price_b2c         numeric(12,2) not null default 0,
  price_b2b         numeric(12,2) not null default 0,
  min_quantity_b2b  int not null default 1,
  unit_label        text not null default 'unidad',
  weight_grams      int,
  freezer_required  boolean not null default false,
  is_active         boolean not null default true,
  cover_image_url   text,
  gallery_urls      jsonb not null default '[]',
  metadata          jsonb not null default '{}',
  costo             numeric(12,2),
  kg_caja           numeric(8,3),
  bolsas_caja       int,
  pkg_unitario      int,
  pkg_bulto         int,
  margen_dist       numeric(6,4),
  margen_gastro     numeric(6,4),
  margen_min        numeric(6,4),
  mult_bolsas       boolean,
  precio_dist       numeric(12,2),
  precio_gastro     numeric(12,2),
  precio_min        numeric(12,2),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.products enable row level security;

do $$ begin
  create policy "Todos ven productos activos"
    on public.products for select using (is_active = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins gestionan productos"
    on public.products for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ── 7. TABLA: sucursales ────────────────────────────────────

create table if not exists public.sucursales (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  encargado_nombre   text,
  encargado_telefono text,
  encargado_email    text,
  direccion          text,
  localidad          text not null default 'Posadas',
  provincia          text not null default 'Misiones',
  notas              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.sucursales enable row level security;

do $$ begin
  create policy "Solo admins gestionan sucursales"
    on public.sucursales for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

drop trigger if exists sucursales_updated_at on public.sucursales;
create trigger sucursales_updated_at
  before update on public.sucursales
  for each row execute function public.set_updated_at();

-- ── 8. TABLA: platform_settings ─────────────────────────────

create table if not exists public.platform_settings (
  id                     int primary key default 1 check (id = 1),
  ideaia_commission_rate numeric(5,4) not null default 0.10,
  bank_cbu               text not null default '',
  bank_alias             text not null default '',
  bank_holder            text not null default 'En Minutas',
  cuit_emisor            text not null default '',
  whatsapp_phone_display text,
  updated_at             timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

do $$ begin
  create policy "Admins gestionan settings"
    on public.platform_settings for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

insert into public.platform_settings (id) values (1) on conflict do nothing;

-- ── 9. FUNCIÓN current_role (helper) ───────────────────────

create or replace function public.current_role()
returns text
language sql
security definer
stable
as $$
  select auth.jwt() -> 'app_metadata' ->> 'role';
$$;

-- ── 10. GRANTS ──────────────────────────────────────────────

grant usage on schema public to anon, authenticated;

-- anon solo puede ver (RLS filtra qué filas)
grant select on public.categories       to anon;
grant select on public.products         to anon;

-- authenticated necesita todo (RLS controla acceso por fila)
grant select, insert, update, delete on public.profiles          to authenticated;
grant select, insert, update, delete on public.categories        to authenticated;
grant select, insert, update, delete on public.products          to authenticated;
grant select, insert, update, delete on public.sucursales        to authenticated;
grant select, insert, update, delete on public.platform_settings to authenticated;

-- Funciones
grant execute on function public.is_admin()      to anon, authenticated;
grant execute on function public.current_role()  to anon, authenticated;
