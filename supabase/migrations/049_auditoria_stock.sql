-- Auditoria diaria de stock: el personal (vendedor/encargado) cuenta la
-- mercaderia contra lo que el sistema cree que hay, y si no coincide deja
-- una observacion. El ajuste de stock NO es automatico -- queda pendiente
-- hasta que un admin lo aprueba desde /admin/auditoria (mismo criterio que
-- la verificacion del sobre de efectivo: nadie da algo por resuelto sin que
-- otra persona lo confirme).

create table public.auditorias_stock (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  fecha       date not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (sucursal_id, fecha)
);

create table public.auditoria_stock_items (
  id               uuid primary key default gen_random_uuid(),
  auditoria_id     uuid not null references public.auditorias_stock(id) on delete cascade,
  product_id       uuid not null references public.products(id),
  stock_sistema    numeric not null,
  stock_contado    numeric not null,
  diferencia       numeric generated always as (stock_contado - stock_sistema) stored,
  observacion      text,
  revisado_por     uuid references auth.users(id),
  revisado_en      timestamptz,
  ajuste_aplicado  boolean not null default false,
  nota_admin       text,
  created_at       timestamptz not null default now()
);

create index auditoria_stock_items_auditoria_idx on public.auditoria_stock_items (auditoria_id);
create index auditoria_stock_items_pendientes_idx on public.auditoria_stock_items (product_id)
  where diferencia <> 0 and revisado_por is null;

alter table public.auditorias_stock enable row level security;
alter table public.auditoria_stock_items enable row level security;

create policy "admin_all_auditorias_stock" on public.auditorias_stock
  for all to authenticated
  using (is_admin()) with check (is_admin());

create policy "staff_select_auditorias_stock" on public.auditorias_stock
  for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

create policy "admin_all_auditoria_stock_items" on public.auditoria_stock_items
  for all to authenticated
  using (is_admin()) with check (is_admin());

create policy "staff_select_auditoria_stock_items" on public.auditoria_stock_items
  for select to authenticated
  using (
    is_admin()
    or auditoria_id in (
      select id from public.auditorias_stock a
      where a.sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
         or a.sucursal_id = my_sucursal_id()
    )
  );

-- Los inserts (crear auditoria + items) y los updates (aprobar/marcar revisado)
-- van siempre via server action con el cliente admin (service role), igual que
-- crearMovimiento en movimientos/actions.ts -- la autorizacion se valida en
-- codigo, no con policies de INSERT/UPDATE para staff.
