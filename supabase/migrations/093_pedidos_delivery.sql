-- Fase 5 del storefront (delivery): agrega la dirección de entrega que le
-- faltaba a "pedidos" desde la migración 091, y una policy de RLS angosta
-- para el rol nuevo "repartidor" (solo ve los pedidos que tiene asignados).
--
-- "repartidor" NO se agrega a is_admin() ni a ninguna policy existente --
-- ese rol queda contenido a esto y a lo que sus propias Server Actions
-- consulten con service_role, ver src/lib/auth/require-role.ts
-- (requireRepartidor) y el plan de esta fase.

alter table public.pedidos
  add column if not exists direccion_entrega text;

-- NOT VALID: no rompe si hubiera alguna fila delivery existente sin
-- dirección (no debería haber ninguna, pedidos recién empieza a usarse en
-- producción) -- mismo criterio prudente que el resto de este proyecto al
-- agregar constraints sobre tablas con datos reales.
alter table public.pedidos
  add constraint pedidos_direccion_entrega_delivery
  check (tipo_entrega <> 'delivery' or direccion_entrega is not null)
  not valid;

create policy "repartidor_select_pedidos_propios" on public.pedidos
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'repartidor'
    and repartidor_id = auth.uid()
  );
