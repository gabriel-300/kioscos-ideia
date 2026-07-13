-- CRM de nichos de mercado -- brief de Javier para Costanera Posadas (sucursal
-- de kioscos-ideia). Arranca simple: carga manual de contactos por el encargado
-- del local, sin automatizacion de WhatsApp/redes todavia (eso queda para una
-- fase posterior si el uso real lo justifica). El catalogo de nichos es global
-- (reusable entre sucursales si algun dia se suma otro local con nichos propios);
-- no se agrega la tabla puente "nichos_x_local" del brief original porque hoy
-- hay un solo local usandolos -- se agrega el dia que haga falta diferenciar.

create table public.nichos (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  descripcion  text,
  horario_pico text,
  color_tag    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.nichos enable row level security;

create policy admin_all_nichos on public.nichos
  for all to authenticated
  using ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'))
  with check ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'));

-- Encargado necesita LEER el catalogo para elegir nicho al cargar un contacto,
-- pero no puede modificarlo -- eso es admin-only, mismo criterio que categorias.
create policy staff_select_nichos on public.nichos
  for select to authenticated
  using ((((auth.jwt() -> 'app_metadata') ->> 'role') in ('admin', 'encargado', 'vendedor')));

insert into public.nichos (nombre, descripcion, horario_pico, color_tag) values
  ('Boliche / nocturno', 'Gente que sale de bailar en el centro y busca comer para bajar el alcohol. Diferencial clave: uno de los pocos locales abiertos vie/sab/dom de madrugada.', 'Vie-dom madrugada', '#7C3AED'),
  ('Vecinos del parque', 'Residentes de los edificios cercanos al Parque Maria Morinigo. Publico cautivo por cercania.', 'Manana/tarde', '#059669'),
  ('Aduana / Migraciones', 'Trabajadores del paso internacional Posadas-Encarnacion.', 'Cambios de turno', '#0369A1'),
  ('Placita del puente', 'Transito peatonal cerca del acceso al puente internacional.', 'Mediodia', '#C05621');

create table public.contactos_crm (
  id                uuid primary key default gen_random_uuid(),
  fecha_hora        timestamptz not null default now(),
  sucursal_id       uuid not null references public.sucursales(id) on delete cascade,
  nicho_id          uuid references public.nichos(id) on delete set null,
  canal             text not null check (canal in ('whatsapp', 'instagram', 'pedidosya', 'otro')),
  nombre_contacto   text,
  consulta_mensaje  text,
  estado            text not null default 'nuevo' check (estado in ('nuevo', 'en_atencion', 'convertido', 'perdido')),
  atendido_por      uuid references auth.users(id) on delete set null,
  convertido_pedido boolean not null default false,
  monto             numeric,
  notas             text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.contactos_crm enable row level security;

create trigger contactos_crm_updated_at
  before update on public.contactos_crm
  for each row execute function public.set_updated_at();

create policy admin_all_contactos_crm on public.contactos_crm
  for all to authenticated
  using ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'))
  with check ((((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'));

-- Encargado: solo su propia sucursal, igual que el resto de sus permisos
-- (movimientos, stock). No hay policy de vendedor -- el brief pide que lo
-- cargue "algun encargado de local", no el vendedor de turno.
create policy encargado_select_contactos_crm on public.contactos_crm
  for select to authenticated
  using (sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()));

create policy encargado_insert_contactos_crm on public.contactos_crm
  for insert to authenticated
  with check (sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()));

create policy encargado_update_contactos_crm on public.contactos_crm
  for update to authenticated
  using (sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()))
  with check (sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid()));

create index contactos_crm_sucursal_idx on public.contactos_crm (sucursal_id);
create index contactos_crm_nicho_idx    on public.contactos_crm (nicho_id);
create index contactos_crm_estado_idx   on public.contactos_crm (estado);
