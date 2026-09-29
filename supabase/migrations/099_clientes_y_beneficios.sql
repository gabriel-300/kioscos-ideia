-- Clientes registrados (login con Google) y beneficios para ellos.
--
-- Todo arranca apagado: los beneficios en 0/false, así que aplicar esta
-- migración no cambia nada de lo que hoy funciona. Solo agrega columnas
-- nuevas (que empiezan vacías) y una tabla nueva; no toca ninguna tabla de
-- plata existente ni ninguna policy.
--
-- Orden de despliegue: aplicar esta migración ANTES de subir el código que
-- lee estas columnas (crearPedidoPublico y /pedir las consultan).

create table public.clientes (
  id                     uuid primary key references auth.users(id) on delete cascade,
  nombre                 text,
  telefono               text,
  telefono_verificado_at timestamptz,          -- lo marca solo el servidor
  created_at             timestamptz not null default now()
);

alter table public.clientes enable row level security;

-- Cada cliente ve y edita solo su fila. Las altas las hace el servidor
-- (service role) al volver de Google: no hay policy de insert.
create policy clientes_ver_propio on public.clientes
  for select to authenticated
  using (id = (select auth.uid()));

create policy clientes_editar_propio on public.clientes
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Puede cambiar nombre y teléfono, pero NO marcarse a sí mismo como
-- verificado: si pudiera, la verificación del teléfono no serviría.
revoke update on public.clientes from authenticated;
grant  update (nombre, telefono) on public.clientes to authenticated;

alter table public.pedidos
  add column cliente_id uuid references public.clientes(id);

create index pedidos_cliente_idx on public.pedidos (cliente_id) where cliente_id is not null;

-- Beneficios por sucursal. pedidos.descuento_total ya existe (migración 091).
alter table public.sucursales
  add column descuento_cliente_pct          numeric(5,2) not null default 0
    check (descuento_cliente_pct between 0 and 100),          -- % sobre productos; 0 = sin descuento
  add column descuento_cliente_solo_primera boolean not null default false,  -- el % vale solo en la primera compra
  add column envio_gratis_primera_compra    boolean not null default false;  -- envío gratis en la primera compra
