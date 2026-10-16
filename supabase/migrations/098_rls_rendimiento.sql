-- 098_rls_rendimiento.sql
--
-- Optimizacion PURA de RLS: no cambia que ve ni que puede hacer ningun rol
-- (admin, encargado, vendedor, concesionario, repartidor, anonimo). Solo cambia
-- como se evalua.
--
-- Por que: get_advisors (performance, 2026-09-25) midio
--   * 45 avisos auth_rls_initplan: auth.uid() / auth.jwt() sin envolver en
--     (select ...) se reevaluan por CADA fila.
--   * 46 avisos multiple_permissive_policies: varias policies permisivas para el
--     mismo rol y comando; Postgres las evalua todas.
--   * profiles (13 filas) con ~114 millones de lecturas secuenciales: es
--     my_sucursal_id() (SECURITY DEFINER, hace `select ... from profiles where
--     id = auth.uid()`) llamada una vez POR FILA de movimientos, cierres, etc.
--
-- Que hace (tres transformaciones, todas equivalentes):
--   1. Envolver en (select ...) auth.uid(), auth.jwt(), is_admin() y
--      my_sucursal_id(): pasan a ser un InitPlan que se calcula una vez por consulta.
--      Los tres helpers son STABLE y solo dependen de la sesion (JWT), no de la fila.
--   2. Unir con OR las policies permisivas del mismo rol y comando (una policy
--      permisiva combinada = OR de sus condiciones; en UPDATE se combinan USING y
--      WITH CHECK por separado, igual que hace Postgres).
--   3. Las policies FOR ALL que compartian tabla con una FOR SELECT se reparten en
--      FOR INSERT / UPDATE / DELETE (mismas condiciones) y su parte de SELECT se
--      absorbe en la policy SELECT unica. Sin policy de un comando, ese comando
--      queda denegado, igual que antes para quien no cumplia la condicion.
--
-- Lo que NO se toco (ver el resumen de la sesion): la funcion
-- movimiento_visible_por_turno (recibe columnas de la fila, no se puede envolver),
-- las policies de una sola condicion por tabla salvo el envoltorio, y las policies
-- TO public de aperturas_caja (no se une el admin con las TO authenticated: cambiaria
-- el conjunto de roles).
--
-- Base de produccion sin staging: se corre en UNA transaccion. Antes de aplicar,
-- correr scripts/rls-rendimiento/probar_migracion_con_rollback.sql (hace todo con
-- ROLLBACK y compara por rol). Reversion completa:
-- scripts/rls-rendimiento/098_reversion.sql (texto exacto de las policies vivas
-- al 2026-09-25).
--
-- Idempotente: cada policy se borra (por nombre viejo y nuevo) y se crea de nuevo.

begin;

-- Si una tabla esta ocupada por una consulta larga, fallar rapido en vez de
-- encolar un ACCESS EXCLUSIVE que frena al resto del POS. Si falla, no se aplico
-- nada: volver a correr.
set local lock_timeout = '10s';

-- ============================================================================
-- alertas_precio  (una sola policy: solo el envoltorio)
-- ============================================================================
drop policy if exists admin_all_alertas_precio on public.alertas_precio;
create policy admin_all_alertas_precio on public.alertas_precio
  for all to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));

-- ============================================================================
-- aperturas_caja
--   admin_all_aperturas es TO public: se deja aparte (solo el envoltorio).
--   Las 3 SELECT TO authenticated se unen en una.
-- ============================================================================
drop policy if exists admin_all_aperturas on public.aperturas_caja;
drop policy if exists concesionario_select_aperturas on public.aperturas_caja;
drop policy if exists encargado_select_aperturas on public.aperturas_caja;
drop policy if exists vendedor_select_aperturas on public.aperturas_caja;
drop policy if exists staff_select_aperturas on public.aperturas_caja;

create policy admin_all_aperturas on public.aperturas_caja
  for all to public
  using ((((select auth.jwt()) ->> 'app_metadata')::jsonb ->> 'role') = 'admin');

create policy staff_select_aperturas on public.aperturas_caja
  for select to authenticated
  using (
    (
      ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'concesionario')
      and (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    )
    or (
      ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'encargado')
      and (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    )
    or (
      ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'vendedor')
      and (sucursal_id = (select my_sucursal_id()))
    )
  );

-- ============================================================================
-- auditoria_stock_items / auditorias_stock
--   La SELECT del staff ya incluia is_admin(): absorbe la parte SELECT del ALL.
-- ============================================================================
drop policy if exists admin_all_auditoria_stock_items on public.auditoria_stock_items;
drop policy if exists admin_insert_auditoria_stock_items on public.auditoria_stock_items;
drop policy if exists admin_update_auditoria_stock_items on public.auditoria_stock_items;
drop policy if exists admin_delete_auditoria_stock_items on public.auditoria_stock_items;
drop policy if exists staff_select_auditoria_stock_items on public.auditoria_stock_items;

create policy admin_insert_auditoria_stock_items on public.auditoria_stock_items
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_auditoria_stock_items on public.auditoria_stock_items
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_auditoria_stock_items on public.auditoria_stock_items
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_auditoria_stock_items on public.auditoria_stock_items
  for select to authenticated
  using (
    (select is_admin())
    or (auditoria_id in (
      select a.id
      from public.auditorias_stock a
      where (
        (
          (a.sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
          or (a.sucursal_id = (select my_sucursal_id()))
        )
        and movimiento_visible_por_turno(a.sucursal_id, a.fecha, a.created_at)
      )
    ))
  );

drop policy if exists admin_all_auditorias_stock on public.auditorias_stock;
drop policy if exists admin_insert_auditorias_stock on public.auditorias_stock;
drop policy if exists admin_update_auditorias_stock on public.auditorias_stock;
drop policy if exists admin_delete_auditorias_stock on public.auditorias_stock;
drop policy if exists staff_select_auditorias_stock on public.auditorias_stock;

create policy admin_insert_auditorias_stock on public.auditorias_stock
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_auditorias_stock on public.auditorias_stock
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_auditorias_stock on public.auditorias_stock
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_auditorias_stock on public.auditorias_stock
  for select to authenticated
  using (
    (select is_admin())
    or (
      (
        (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
        or (sucursal_id = (select my_sucursal_id()))
      )
      and movimiento_visible_por_turno(sucursal_id, fecha, created_at)
    )
  );

-- ============================================================================
-- categories  (cada comando ya tiene una sola policy: solo el envoltorio;
--              categories_select_anon no se toca)
-- ============================================================================
drop policy if exists categories_admin_delete on public.categories;
drop policy if exists categories_admin_insert on public.categories;
drop policy if exists categories_admin_update on public.categories;
drop policy if exists categories_select_auth on public.categories;

create policy categories_admin_delete on public.categories
  for delete to authenticated
  using ((select is_admin()));
create policy categories_admin_insert on public.categories
  for insert to authenticated
  with check ((select is_admin()));
create policy categories_admin_update on public.categories
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy categories_select_auth on public.categories
  for select to authenticated
  using ((is_active = true) or (select is_admin()));

-- ============================================================================
-- cierres_caja
-- ============================================================================
drop policy if exists admin_all_cierres on public.cierres_caja;
drop policy if exists concesionario_select_cierres on public.cierres_caja;
drop policy if exists encargado_select_cierres on public.cierres_caja;
drop policy if exists vendedor_select_cierres on public.cierres_caja;
drop policy if exists admin_insert_cierres on public.cierres_caja;
drop policy if exists admin_update_cierres on public.cierres_caja;
drop policy if exists admin_delete_cierres on public.cierres_caja;
drop policy if exists staff_select_cierres on public.cierres_caja;

create policy admin_insert_cierres on public.cierres_caja
  for insert to authenticated
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy admin_update_cierres on public.cierres_caja
  for update to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy admin_delete_cierres on public.cierres_caja
  for delete to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy staff_select_cierres on public.cierres_caja
  for select to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
    or (
      ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'concesionario')
      and (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    )
    or (
      ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'encargado')
      and (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    )
    or (
      ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'vendedor')
      and (sucursal_id = (select my_sucursal_id()))
    )
  );

-- ============================================================================
-- contactos_crm
--   INSERT admin+encargado unidos; UPDATE admin+encargado unidos; SELECT
--   admin+encargado; DELETE solo admin.
-- ============================================================================
drop policy if exists admin_all_contactos_crm on public.contactos_crm;
drop policy if exists encargado_insert_contactos_crm on public.contactos_crm;
drop policy if exists encargado_select_contactos_crm on public.contactos_crm;
drop policy if exists encargado_update_contactos_crm on public.contactos_crm;
drop policy if exists contactos_crm_select on public.contactos_crm;
drop policy if exists contactos_crm_insert on public.contactos_crm;
drop policy if exists contactos_crm_update on public.contactos_crm;
drop policy if exists admin_delete_contactos_crm on public.contactos_crm;

create policy contactos_crm_select on public.contactos_crm
  for select to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy contactos_crm_insert on public.contactos_crm
  for insert to authenticated
  with check (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy contactos_crm_update on public.contactos_crm
  for update to authenticated
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  )
  with check (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy admin_delete_contactos_crm on public.contactos_crm
  for delete to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

-- ============================================================================
-- cta_corriente_pagos / movimientos_socio / pagos_proveedor / pagos_socio
--   Cada una tenia SELECT (admin | encargado | vendedor de la sucursal) y un ALL
--   (admin | encargado). La SELECT ya contiene todo lo del ALL: el ALL se reparte
--   en INSERT / UPDATE / DELETE con las mismas condiciones.
-- ============================================================================
drop policy if exists ctc_pagos_select on public.cta_corriente_pagos;
drop policy if exists ctc_pagos_write on public.cta_corriente_pagos;
drop policy if exists ctc_pagos_insert on public.cta_corriente_pagos;
drop policy if exists ctc_pagos_update on public.cta_corriente_pagos;
drop policy if exists ctc_pagos_delete on public.cta_corriente_pagos;

create policy ctc_pagos_select on public.cta_corriente_pagos
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );
create policy ctc_pagos_insert on public.cta_corriente_pagos
  for insert to authenticated
  with check (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy ctc_pagos_update on public.cta_corriente_pagos
  for update to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  )
  with check (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy ctc_pagos_delete on public.cta_corriente_pagos
  for delete to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );

drop policy if exists movimientos_socio_select on public.movimientos_socio;
drop policy if exists movimientos_socio_write on public.movimientos_socio;
drop policy if exists movimientos_socio_insert on public.movimientos_socio;
drop policy if exists movimientos_socio_update on public.movimientos_socio;
drop policy if exists movimientos_socio_delete on public.movimientos_socio;

create policy movimientos_socio_select on public.movimientos_socio
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );
create policy movimientos_socio_insert on public.movimientos_socio
  for insert to authenticated
  with check (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy movimientos_socio_update on public.movimientos_socio
  for update to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  )
  with check (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy movimientos_socio_delete on public.movimientos_socio
  for delete to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );

drop policy if exists pagos_proveedor_select on public.pagos_proveedor;
drop policy if exists pagos_proveedor_write on public.pagos_proveedor;
drop policy if exists pagos_proveedor_insert on public.pagos_proveedor;
drop policy if exists pagos_proveedor_update on public.pagos_proveedor;
drop policy if exists pagos_proveedor_delete on public.pagos_proveedor;

create policy pagos_proveedor_select on public.pagos_proveedor
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );
create policy pagos_proveedor_insert on public.pagos_proveedor
  for insert to authenticated
  with check (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy pagos_proveedor_update on public.pagos_proveedor
  for update to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  )
  with check (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy pagos_proveedor_delete on public.pagos_proveedor
  for delete to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );

drop policy if exists pagos_socio_select on public.pagos_socio;
drop policy if exists pagos_socio_write on public.pagos_socio;
drop policy if exists pagos_socio_insert on public.pagos_socio;
drop policy if exists pagos_socio_update on public.pagos_socio;
drop policy if exists pagos_socio_delete on public.pagos_socio;

create policy pagos_socio_select on public.pagos_socio
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );
create policy pagos_socio_insert on public.pagos_socio
  for insert to authenticated
  with check (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy pagos_socio_update on public.pagos_socio
  for update to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  )
  with check (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );
create policy pagos_socio_delete on public.pagos_socio
  for delete to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
  );

-- ============================================================================
-- gastos / gastos_fijos / platform_settings / reposicion_marcas_pedido /
-- pedidoya_webhook_events / whatsapp_webhook_events  (una sola policy: envoltorio)
-- ============================================================================
drop policy if exists admin_all_gastos on public.gastos;
create policy admin_all_gastos on public.gastos
  for all to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

drop policy if exists admin_all_gastos_fijos on public.gastos_fijos;
create policy admin_all_gastos_fijos on public.gastos_fijos
  for all to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

drop policy if exists "Admins gestionan settings" on public.platform_settings;
create policy "Admins gestionan settings" on public.platform_settings
  for all to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));

drop policy if exists admin_all_reposicion_marcas_pedido on public.reposicion_marcas_pedido;
create policy admin_all_reposicion_marcas_pedido on public.reposicion_marcas_pedido
  for all to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));

drop policy if exists "Admins leen eventos de PedidoYa" on public.pedidoya_webhook_events;
create policy "Admins leen eventos de PedidoYa" on public.pedidoya_webhook_events
  for select to authenticated
  using ((select is_admin()));

drop policy if exists "Admins leen eventos de WhatsApp" on public.whatsapp_webhook_events;
create policy "Admins leen eventos de WhatsApp" on public.whatsapp_webhook_events
  for select to authenticated
  using ((select is_admin()));

-- ============================================================================
-- mercadopago_qr_orders / mercadopago_transferencias_recibidas
-- ============================================================================
drop policy if exists admin_all_mercadopago_qr_orders on public.mercadopago_qr_orders;
drop policy if exists admin_insert_mercadopago_qr_orders on public.mercadopago_qr_orders;
drop policy if exists admin_update_mercadopago_qr_orders on public.mercadopago_qr_orders;
drop policy if exists admin_delete_mercadopago_qr_orders on public.mercadopago_qr_orders;
drop policy if exists staff_select_mercadopago_qr_orders on public.mercadopago_qr_orders;

create policy admin_insert_mercadopago_qr_orders on public.mercadopago_qr_orders
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_mercadopago_qr_orders on public.mercadopago_qr_orders
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_mercadopago_qr_orders on public.mercadopago_qr_orders
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_mercadopago_qr_orders on public.mercadopago_qr_orders
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );

drop policy if exists admin_all_mercadopago_transferencias on public.mercadopago_transferencias_recibidas;
drop policy if exists admin_insert_mercadopago_transferencias on public.mercadopago_transferencias_recibidas;
drop policy if exists admin_update_mercadopago_transferencias on public.mercadopago_transferencias_recibidas;
drop policy if exists admin_delete_mercadopago_transferencias on public.mercadopago_transferencias_recibidas;
drop policy if exists staff_select_mercadopago_transferencias on public.mercadopago_transferencias_recibidas;

create policy admin_insert_mercadopago_transferencias on public.mercadopago_transferencias_recibidas
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_mercadopago_transferencias on public.mercadopago_transferencias_recibidas
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_mercadopago_transferencias on public.mercadopago_transferencias_recibidas
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_mercadopago_transferencias on public.mercadopago_transferencias_recibidas
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id is null)
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );

-- ============================================================================
-- movimientos / movimiento_items
--   Cuidado especial: encargado y vendedor ven "su turno" (o lo que ellos mismos
--   crearon). Las dos SELECT del staff se unen en una; la condicion comun
--   (created_by = yo OR visible por turno) se saca de factor comun:
--     (A AND V) OR (B AND V)  ==  (A OR B) AND V     (ley distributiva, vale
--   tambien con NULL en la logica de tres valores). Asi movimiento_visible_por_turno
--   se llama una vez por fila y no dos.
--   En movimiento_items, `id IN (S1) OR id IN (S2)` == `id IN (S1 union S2)`:
--   una sola subconsulta en vez de dos.
-- ============================================================================
drop policy if exists admin_all_movimientos on public.movimientos;
drop policy if exists encargado_select_movimientos on public.movimientos;
drop policy if exists vendedor_select_movimientos on public.movimientos;
drop policy if exists admin_insert_movimientos on public.movimientos;
drop policy if exists admin_update_movimientos on public.movimientos;
drop policy if exists admin_delete_movimientos on public.movimientos;
drop policy if exists staff_select_movimientos on public.movimientos;

create policy admin_insert_movimientos on public.movimientos
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_movimientos on public.movimientos
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_movimientos on public.movimientos
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_movimientos on public.movimientos
  for select to authenticated
  using (
    (select is_admin())
    or (
      (
        (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
        or (sucursal_id = (select my_sucursal_id()))
      )
      and (
        (created_by = (select auth.uid()))
        or movimiento_visible_por_turno(sucursal_id, fecha, created_at)
      )
    )
  );

drop policy if exists admin_all_movimiento_items on public.movimiento_items;
drop policy if exists encargado_select_movimiento_items on public.movimiento_items;
drop policy if exists vendedor_select_movimiento_items on public.movimiento_items;
drop policy if exists admin_insert_movimiento_items on public.movimiento_items;
drop policy if exists admin_update_movimiento_items on public.movimiento_items;
drop policy if exists admin_delete_movimiento_items on public.movimiento_items;
drop policy if exists staff_select_movimiento_items on public.movimiento_items;

create policy admin_insert_movimiento_items on public.movimiento_items
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_movimiento_items on public.movimiento_items
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_movimiento_items on public.movimiento_items
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_movimiento_items on public.movimiento_items
  for select to authenticated
  using (
    (select is_admin())
    or (movimiento_id in (
      select m.id
      from public.movimientos m
      where (
        (
          (m.sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
          or (m.sucursal_id = (select my_sucursal_id()))
        )
        and (
          (m.created_by = (select auth.uid()))
          or movimiento_visible_por_turno(m.sucursal_id, m.fecha, m.created_at)
        )
      )
    ))
  );

-- ============================================================================
-- nichos
--   staff_select ya incluia 'admin' en la lista de roles: absorbe la SELECT del ALL.
-- ============================================================================
drop policy if exists admin_all_nichos on public.nichos;
drop policy if exists admin_insert_nichos on public.nichos;
drop policy if exists admin_update_nichos on public.nichos;
drop policy if exists admin_delete_nichos on public.nichos;
drop policy if exists staff_select_nichos on public.nichos;

create policy admin_insert_nichos on public.nichos
  for insert to authenticated
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy admin_update_nichos on public.nichos
  for update to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy admin_delete_nichos on public.nichos
  for delete to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy staff_select_nichos on public.nichos
  for select to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = any (array['admin'::text, 'encargado'::text, 'vendedor'::text]));

-- ============================================================================
-- pedidos / pedido_items
-- ============================================================================
drop policy if exists admin_all_pedidos on public.pedidos;
drop policy if exists repartidor_select_pedidos_propios on public.pedidos;
drop policy if exists staff_select_pedidos on public.pedidos;
drop policy if exists admin_insert_pedidos on public.pedidos;
drop policy if exists admin_update_pedidos on public.pedidos;
drop policy if exists admin_delete_pedidos on public.pedidos;

create policy admin_insert_pedidos on public.pedidos
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_pedidos on public.pedidos
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_pedidos on public.pedidos
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_pedidos on public.pedidos
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
    or (
      ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'repartidor')
      and (repartidor_id = (select auth.uid()))
    )
  );

drop policy if exists admin_all_pedido_items on public.pedido_items;
drop policy if exists admin_insert_pedido_items on public.pedido_items;
drop policy if exists admin_update_pedido_items on public.pedido_items;
drop policy if exists admin_delete_pedido_items on public.pedido_items;
drop policy if exists staff_select_pedido_items on public.pedido_items;

create policy admin_insert_pedido_items on public.pedido_items
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_pedido_items on public.pedido_items
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_pedido_items on public.pedido_items
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_pedido_items on public.pedido_items
  for select to authenticated
  using (
    (select is_admin())
    or exists (
      select 1
      from public.pedidos p
      where (
        (p.id = pedido_items.pedido_id)
        and (
          (select is_admin())
          or (p.sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
          or (p.sucursal_id = (select my_sucursal_id()))
        )
      )
    )
  );

-- ============================================================================
-- prestamos_termo / termos
-- ============================================================================
drop policy if exists admin_all_prestamos_termo on public.prestamos_termo;
drop policy if exists admin_insert_prestamos_termo on public.prestamos_termo;
drop policy if exists admin_update_prestamos_termo on public.prestamos_termo;
drop policy if exists admin_delete_prestamos_termo on public.prestamos_termo;
drop policy if exists staff_select_prestamos_termo on public.prestamos_termo;

create policy admin_insert_prestamos_termo on public.prestamos_termo
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_prestamos_termo on public.prestamos_termo
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_prestamos_termo on public.prestamos_termo
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_prestamos_termo on public.prestamos_termo
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );

drop policy if exists admin_all_termos on public.termos;
drop policy if exists admin_insert_termos on public.termos;
drop policy if exists admin_update_termos on public.termos;
drop policy if exists admin_delete_termos on public.termos;
drop policy if exists staff_select_termos on public.termos;

create policy admin_insert_termos on public.termos
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_termos on public.termos
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_termos on public.termos
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_termos on public.termos
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );

-- ============================================================================
-- product_price_history  (INSERT y SELECT son comandos distintos: envoltorio)
-- ============================================================================
drop policy if exists admin_read_ph on public.product_price_history;
create policy admin_read_ph on public.product_price_history
  for select to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

drop policy if exists admin_write_ph on public.product_price_history;
create policy admin_write_ph on public.product_price_history
  for insert to public
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

-- ============================================================================
-- product_prices / promo_items / promo_prices / promos
--   La SELECT "Staff lee ..." es `using (true)` y NO se toca (ya contiene la
--   parte SELECT del ALL de admin). El ALL de admin se reparte en I/U/D.
-- ============================================================================
drop policy if exists "Admins gestionan product_prices" on public.product_prices;
drop policy if exists admin_insert_product_prices on public.product_prices;
drop policy if exists admin_update_product_prices on public.product_prices;
drop policy if exists admin_delete_product_prices on public.product_prices;
create policy admin_insert_product_prices on public.product_prices
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_product_prices on public.product_prices
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_product_prices on public.product_prices
  for delete to authenticated
  using ((select is_admin()));

drop policy if exists "Admins gestionan promo_items" on public.promo_items;
drop policy if exists admin_insert_promo_items on public.promo_items;
drop policy if exists admin_update_promo_items on public.promo_items;
drop policy if exists admin_delete_promo_items on public.promo_items;
create policy admin_insert_promo_items on public.promo_items
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_promo_items on public.promo_items
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_promo_items on public.promo_items
  for delete to authenticated
  using ((select is_admin()));

drop policy if exists "Admins gestionan promo_prices" on public.promo_prices;
drop policy if exists admin_insert_promo_prices on public.promo_prices;
drop policy if exists admin_update_promo_prices on public.promo_prices;
drop policy if exists admin_delete_promo_prices on public.promo_prices;
create policy admin_insert_promo_prices on public.promo_prices
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_promo_prices on public.promo_prices
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_promo_prices on public.promo_prices
  for delete to authenticated
  using ((select is_admin()));

drop policy if exists "Admins gestionan promos" on public.promos;
drop policy if exists admin_insert_promos on public.promos;
drop policy if exists admin_update_promos on public.promos;
drop policy if exists admin_delete_promos on public.promos;
create policy admin_insert_promos on public.promos
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_promos on public.promos
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_promos on public.promos
  for delete to authenticated
  using ((select is_admin()));

-- ============================================================================
-- products  (cada comando ya tiene una sola policy por rol: envoltorio;
--            products_select_anon no se toca)
-- ============================================================================
drop policy if exists products_admin_delete on public.products;
drop policy if exists products_admin_insert on public.products;
drop policy if exists products_admin_update on public.products;
drop policy if exists products_select_auth on public.products;

create policy products_admin_delete on public.products
  for delete to authenticated
  using ((select is_admin()));
create policy products_admin_insert on public.products
  for insert to authenticated
  with check ((select is_admin()));
create policy products_admin_update on public.products
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy products_select_auth on public.products
  for select to authenticated
  using ((is_active = true) or (select is_admin()));

-- ============================================================================
-- profile_sucursales
-- ============================================================================
drop policy if exists admin_all_profile_sucursales on public.profile_sucursales;
drop policy if exists own_select_profile_sucursales on public.profile_sucursales;
drop policy if exists admin_insert_profile_sucursales on public.profile_sucursales;
drop policy if exists admin_update_profile_sucursales on public.profile_sucursales;
drop policy if exists admin_delete_profile_sucursales on public.profile_sucursales;
drop policy if exists profile_sucursales_select on public.profile_sucursales;

create policy admin_insert_profile_sucursales on public.profile_sucursales
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_profile_sucursales on public.profile_sucursales
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_profile_sucursales on public.profile_sucursales
  for delete to authenticated
  using ((select is_admin()));
create policy profile_sucursales_select on public.profile_sucursales
  for select to authenticated
  using ((select is_admin()) or (profile_id = (select auth.uid())));

-- ============================================================================
-- profiles
--   Las 3 SELECT (propio/admin, encargado de la sucursal, vendedor de la
--   sucursal) se unen. No se agrega ninguna referencia nueva entre tablas
--   (sigue leyendo sucursales y my_sucursal_id(), que es SECURITY DEFINER):
--   no se introduce recursion.
-- ============================================================================
drop policy if exists encargado_view_sucursal_profiles on public.profiles;
drop policy if exists profiles_select on public.profiles;
drop policy if exists vendedor_view_sucursal_profiles on public.profiles;
drop policy if exists profiles_update on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    ((select auth.uid()) = id)
    or (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );
create policy profiles_update on public.profiles
  for update to authenticated
  using (((select auth.uid()) = id) or (select is_admin()))
  with check (((select auth.uid()) = id) or (select is_admin()));

-- ============================================================================
-- proveedores  (todas TO public)
--   staff_read incluye 'admin' en su lista: absorbe la SELECT del ALL.
--   admin_all no tenia WITH CHECK: usaba el USING.
-- ============================================================================
drop policy if exists admin_all_proveedores on public.proveedores;
drop policy if exists staff_read_proveedores on public.proveedores;
drop policy if exists admin_insert_proveedores on public.proveedores;
drop policy if exists admin_update_proveedores on public.proveedores;
drop policy if exists admin_delete_proveedores on public.proveedores;

create policy admin_insert_proveedores on public.proveedores
  for insert to public
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy admin_update_proveedores on public.proveedores
  for update to public
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy admin_delete_proveedores on public.proveedores
  for delete to public
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy staff_read_proveedores on public.proveedores
  for select to public
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = any (array['admin'::text, 'encargado'::text, 'vendedor'::text]));

-- ============================================================================
-- retiros_caja  (todas TO public)
--   SELECT: admin | encargado | vendedor. INSERT: admin | encargado.
--   UPDATE / DELETE: solo admin.
-- ============================================================================
drop policy if exists admin_all_retiros on public.retiros_caja;
drop policy if exists encargado_insert_retiros on public.retiros_caja;
drop policy if exists encargado_select_retiros on public.retiros_caja;
drop policy if exists vendedor_select_retiros on public.retiros_caja;
drop policy if exists retiros_caja_select on public.retiros_caja;
drop policy if exists retiros_caja_insert on public.retiros_caja;
drop policy if exists admin_update_retiros on public.retiros_caja;
drop policy if exists admin_delete_retiros on public.retiros_caja;

create policy retiros_caja_select on public.retiros_caja
  for select to public
  using (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
    or ((select auth.uid()) in (select sucursales.encargado_user_id from public.sucursales where sucursales.id = retiros_caja.sucursal_id))
    or (sucursal_id = (select my_sucursal_id()))
  );
create policy retiros_caja_insert on public.retiros_caja
  for insert to public
  with check (
    ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
    or ((select auth.uid()) in (select sucursales.encargado_user_id from public.sucursales where sucursales.id = retiros_caja.sucursal_id))
  );
create policy admin_update_retiros on public.retiros_caja
  for update to public
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy admin_delete_retiros on public.retiros_caja
  for delete to public
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

-- ============================================================================
-- sucursales
--   Las 3 SELECT del staff + la parte SELECT del ALL de admin en una; el ALL se
--   reparte en I/U/D. Otras policies leen sucursales en subconsultas: el
--   conjunto de filas visibles para cada rol es identico.
-- ============================================================================
drop policy if exists "Solo admins gestionan sucursales" on public.sucursales;
drop policy if exists encargado_view_own_sucursal on public.sucursales;
drop policy if exists vendedor_view_assigned_sucursales on public.sucursales;
drop policy if exists vendedor_view_own_sucursal on public.sucursales;
drop policy if exists admin_insert_sucursales on public.sucursales;
drop policy if exists admin_update_sucursales on public.sucursales;
drop policy if exists admin_delete_sucursales on public.sucursales;
drop policy if exists sucursales_select on public.sucursales;

create policy admin_insert_sucursales on public.sucursales
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_sucursales on public.sucursales
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_sucursales on public.sucursales
  for delete to authenticated
  using ((select is_admin()));
create policy sucursales_select on public.sucursales
  for select to authenticated
  using (
    (select is_admin())
    or (encargado_user_id = (select auth.uid()))
    or exists (
      select 1
      from public.profile_sucursales ps
      where ((ps.sucursal_id = sucursales.id) and (ps.profile_id = (select auth.uid())))
    )
    or (id = (select my_sucursal_id()))
  );

-- ============================================================================
-- transferencia_items / transferencias_stock / traspasos_caja / zonas_entrega
-- ============================================================================
drop policy if exists admin_all_transferencia_items on public.transferencia_items;
drop policy if exists admin_insert_transferencia_items on public.transferencia_items;
drop policy if exists admin_update_transferencia_items on public.transferencia_items;
drop policy if exists admin_delete_transferencia_items on public.transferencia_items;
drop policy if exists staff_select_transferencia_items on public.transferencia_items;

create policy admin_insert_transferencia_items on public.transferencia_items
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_transferencia_items on public.transferencia_items
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_transferencia_items on public.transferencia_items
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_transferencia_items on public.transferencia_items
  for select to authenticated
  using (
    (select is_admin())
    or (transferencia_id in (
      select t.id
      from public.transferencias_stock t
      where (
        (t.sucursal_origen_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
        or (t.sucursal_destino_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
        or (t.sucursal_origen_id = (select my_sucursal_id()))
        or (t.sucursal_destino_id = (select my_sucursal_id()))
      )
    ))
  );

drop policy if exists admin_all_transferencias_stock on public.transferencias_stock;
drop policy if exists admin_insert_transferencias_stock on public.transferencias_stock;
drop policy if exists admin_update_transferencias_stock on public.transferencias_stock;
drop policy if exists admin_delete_transferencias_stock on public.transferencias_stock;
drop policy if exists staff_select_transferencias_stock on public.transferencias_stock;

create policy admin_insert_transferencias_stock on public.transferencias_stock
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_transferencias_stock on public.transferencias_stock
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_transferencias_stock on public.transferencias_stock
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_transferencias_stock on public.transferencias_stock
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_origen_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_destino_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_origen_id = (select my_sucursal_id()))
    or (sucursal_destino_id = (select my_sucursal_id()))
  );

drop policy if exists traspasos_caja_admin_write on public.traspasos_caja;
drop policy if exists traspasos_caja_admin_insert on public.traspasos_caja;
drop policy if exists traspasos_caja_admin_update on public.traspasos_caja;
drop policy if exists traspasos_caja_admin_delete on public.traspasos_caja;
drop policy if exists traspasos_caja_select on public.traspasos_caja;

create policy traspasos_caja_admin_insert on public.traspasos_caja
  for insert to authenticated
  with check ((select is_admin()));
create policy traspasos_caja_admin_update on public.traspasos_caja
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy traspasos_caja_admin_delete on public.traspasos_caja
  for delete to authenticated
  using ((select is_admin()));
create policy traspasos_caja_select on public.traspasos_caja
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );

drop policy if exists admin_all_zonas_entrega on public.zonas_entrega;
drop policy if exists admin_insert_zonas_entrega on public.zonas_entrega;
drop policy if exists admin_update_zonas_entrega on public.zonas_entrega;
drop policy if exists admin_delete_zonas_entrega on public.zonas_entrega;
drop policy if exists staff_select_zonas_entrega on public.zonas_entrega;

create policy admin_insert_zonas_entrega on public.zonas_entrega
  for insert to authenticated
  with check ((select is_admin()));
create policy admin_update_zonas_entrega on public.zonas_entrega
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));
create policy admin_delete_zonas_entrega on public.zonas_entrega
  for delete to authenticated
  using ((select is_admin()));
create policy staff_select_zonas_entrega on public.zonas_entrega
  for select to authenticated
  using (
    (select is_admin())
    or (sucursal_id in (select sucursales.id from public.sucursales where sucursales.encargado_user_id = (select auth.uid())))
    or (sucursal_id = (select my_sucursal_id()))
  );

commit;
