-- Fase 2 del storefront: no existe ningún rate limiting en todo el proyecto
-- (ni Cloudflare KV, ni ningún mecanismo propio) -- esta tabla es la defensa
-- contra abuso de iniciarPedido() (el endpoint público que arma un pago
-- real). Se cuenta en Postgres, mismo criterio "todo pasa por Supabase" que
-- ya usa el resto del proyecto, en vez de sumar infraestructura de
-- Cloudflare nueva.

create table public.pedido_rate_limits (
  id            bigint generated always as identity primary key,
  identificador text not null,  -- cf-connecting-ip, o "tel:<telefono_normalizado>" si el header falta
  created_at    timestamptz not null default now()
);

create index pedido_rate_limits_ident_idx on public.pedido_rate_limits (identificador, created_at desc);

-- Sin RLS/policies de staff: esta tabla no se lee ni escribe desde ningún
-- cliente de sesión, solo desde el código server-side de iniciarPedido()
-- con service_role. RLS igual habilitada por consistencia con el resto del
-- proyecto, sin ninguna policy -- deny-all por default para authenticated/anon.
alter table public.pedido_rate_limits enable row level security;
