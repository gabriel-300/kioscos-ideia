-- Auditoria 15/07: cta_corriente_pagos nunca tuvo un CREATE TABLE ni un
-- ENABLE ROW LEVEL SECURITY en el historial versionado -- la migracion 021
-- solo hace drop/create policy sobre ella, asumiendo que ya existia con RLS
-- activo (se creo directo contra la base, fuera de las migraciones). No hay
-- forma de confirmar desde el codigo si RLS esta realmente prendida en esta
-- tabla de plata real.
--
-- Esta migracion no toca el esquema (no CREATE TABLE -- no se puede
-- reconstruir con certeza el tipo/constraint exacto de cada columna sin
-- conectarse a la base, y un CREATE TABLE mal armado seria peor que no hacer
-- nada). Es idempotente y segura de correr exista o no la tabla ya en el
-- estado esperado:
--   - ENABLE ROW LEVEL SECURITY no falla si ya estaba activa.
--   - DROP POLICY IF EXISTS + CREATE POLICY deja el resultado igual si las
--     politicas ya eran estas mismas (las de la migracion 021).
--
-- A partir de aca el estado de RLS de esta tabla queda confirmado y
-- versionado, sin depender de que 021 haya sido la ultima palabra.

alter table public.cta_corriente_pagos enable row level security;

drop policy if exists "ctc_pagos_select" on public.cta_corriente_pagos;
drop policy if exists "ctc_pagos_write" on public.cta_corriente_pagos;

create policy "ctc_pagos_select" on public.cta_corriente_pagos for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

create policy "ctc_pagos_write" on public.cta_corriente_pagos for all to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
  )
  with check (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
  );
