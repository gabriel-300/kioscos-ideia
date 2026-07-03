-- ============================================================
-- FIX: la migración 021 volvió is_admin() estrictamente admin, lo que
-- dejó "sucursales" en SELECT admin-only. Como las policies nuevas de 021
-- (movimientos/movimiento_items/cta_corriente_pagos) usan subconsultas sobre
-- sucursales, y la página de detalle de sucursal también lee "sucursales"
-- con el cliente que respeta RLS, esto rompía el acceso del propio
-- encargado/vendedor a su propio kiosco. Se agrega lectura del propio registro.
-- Aplicada en producción vía Management API el 2026-07-03.
-- ============================================================

create policy "encargado_view_own_sucursal" on public.sucursales for select to authenticated
  using (encargado_user_id = auth.uid());

create policy "vendedor_view_own_sucursal" on public.sucursales for select to authenticated
  using (id = my_sucursal_id());
