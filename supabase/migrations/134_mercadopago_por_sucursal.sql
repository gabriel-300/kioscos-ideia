-- Mercado Pago por sucursal: un local independiente (catalogo_propio, migración 131) cobra con SU propia cuenta,
-- no con la de IDEIA. Las credenciales viven en una tabla aparte, sin ninguna política RLS y sin permisos para
-- anon/authenticated: solo el servidor (service role) la lee, nunca el navegador. El token va cifrado (AES-GCM) por
-- la aplicación; en la base no queda en claro. Una sucursal sin fila acá sigue usando las credenciales de IDEIA.

create table if not exists sucursal_mercadopago (
  sucursal_id          uuid primary key references sucursales(id) on delete cascade,
  access_token_cifrado text not null,
  mp_user_id           text not null,
  mp_cuenta            text,                       -- nombre/email de la cuenta, solo para mostrar "conectado como..."
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users(id) on delete set null
);

alter table sucursal_mercadopago enable row level security;
-- Sin políticas a propósito: con RLS activo y sin políticas nadie con la clave pública o de usuario ve nada.
revoke all on sucursal_mercadopago from anon, authenticated;
