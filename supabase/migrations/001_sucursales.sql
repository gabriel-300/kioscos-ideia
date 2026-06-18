-- NOTA: Esta tabla ya está incluida en 000_schema_inicial.sql.
-- Este archivo existe como referencia standalone. No es necesario correrlo
-- si ya se ejecutó el 000.

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

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sucursales_updated_at on public.sucursales;
create trigger sucursales_updated_at
  before update on public.sucursales
  for each row execute function public.set_updated_at();

do $$ begin
  create policy "Solo admins gestionan sucursales"
    on public.sucursales for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.sucursales to authenticated;
grant execute on function public.is_admin() to authenticated, anon;
