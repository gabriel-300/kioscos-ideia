-- Fase 0 del storefront/bot de WhatsApp/delivery: solo el esquema, nada lo
-- referencia todavía (cero riesgo). "pedidos" es una entidad propia, no una
-- extensión de contactos_crm -- esa tabla es un tablero de leads con
-- semántica de atención humana, sin teléfono/dirección, y ya enganchada a
-- un circuito distinto (cta. corriente de clientes externos). Ver el plan
-- de esta feature para la justificación completa.
--
-- tipo_entrega/repartidor_id/bot_paso quedan reservados desde ahora (delivery
-- y bot son fases futuras) para no tener que alterar esta tabla ya con
-- pedidos reales cargados más adelante.

create table public.pedidos (
  id                  uuid primary key default gen_random_uuid(),
  sucursal_id         uuid not null references public.sucursales(id),
  origen              text not null check (origen in ('storefront', 'whatsapp')),
  estado              text not null default 'carrito'
                       check (estado in (
                         'carrito', 'pendiente_pago', 'pagado',
                         'en_preparacion', 'listo_retiro', 'en_reparto',
                         'entregado', 'cancelado', 'expirado'
                       )),
  tipo_entrega        text not null default 'retiro_local'
                       check (tipo_entrega in ('retiro_local', 'delivery')),
  cliente_nombre      text,
  cliente_telefono    text,
  cliente_wa_id       text,
  bot_paso            text,
  notas               text,
  subtotal            numeric(12,2) not null default 0,
  descuento_total     numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0,
  medio_pago          text check (medio_pago in ('mercadopago_qr')),
  movimiento_id       uuid references public.movimientos(id),
  repartidor_id       uuid references auth.users(id),
  contacto_id         uuid references public.contactos_crm(id),
  expira_en           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index pedidos_sucursal_estado_idx on public.pedidos (sucursal_id, estado);
create index pedidos_wa_carrito_idx on public.pedidos (cliente_wa_id, sucursal_id) where estado = 'carrito';

create table public.pedido_items (
  id               uuid primary key default gen_random_uuid(),
  pedido_id        uuid not null references public.pedidos(id) on delete cascade,
  product_id       uuid references public.products(id),
  promo_id         uuid references public.promos(id),
  cantidad         numeric(10,2) not null check (cantidad > 0),
  precio_unitario  numeric(12,2),
  subtotal         numeric(12,2)
);

create index pedido_items_pedido_idx on public.pedido_items (pedido_id);

alter table public.mercadopago_qr_orders
  add column if not exists pedido_id uuid references public.pedidos(id);

-- RLS: mismo criterio que transferencias_stock/prestamos_termo (staff ve lo
-- de su sucursal, admin ve todo). Nada de esto se usa todavía (Fase 0/1 son
-- solo lectura pública del catálogo, sin tocar estas tablas) -- se deja
-- preparado para cuando la Fase 2 empiece a escribir acá. Los inserts/updates
-- van a pasar siempre por createAdminClient() (service role) desde server
-- actions nuevas, igual que el resto del proyecto -- RLS queda como defensa
-- en profundidad, no como el mecanismo principal.
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

create policy "admin_all_pedidos" on public.pedidos
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "staff_select_pedidos" on public.pedidos
  for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

create policy "admin_all_pedido_items" on public.pedido_items
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "staff_select_pedido_items" on public.pedido_items
  for select to authenticated
  using (
    exists (
      select 1 from public.pedidos p
      where p.id = pedido_items.pedido_id
        and (
          is_admin()
          or p.sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
          or p.sucursal_id = my_sucursal_id()
        )
    )
  );
