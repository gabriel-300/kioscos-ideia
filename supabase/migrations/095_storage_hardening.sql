-- Auditoría 19/09/2026, hallazgos A-01 y A-02.
--
-- Estado anterior (leído de pg_policies / storage.buckets en la base viva):
--   * remitos: bucket público, sin restricción de tipo, con
--     `public_read_remitos` (SELECT para el rol `public`) -- cualquiera con la
--     anon key podía LISTAR todos los remitos y comprobantes de retiro --, y
--     INSERT/DELETE para cualquier usuario `authenticated` (incluso una cuenta
--     sin rol creada desde /api/auth/registro).
--   * product-images: INSERT/UPDATE/DELETE para cualquier `authenticated`
--     (las policies se llaman "Admin ..." pero solo chequeaban bucket_id).
--
-- Esta migración es la FASE 1: cierra el listado y la escritura indebida sin
-- tocar código de la app (los archivos se siguen viendo por su URL pública, que
-- no depende de ninguna policy mientras el bucket sea público). La FASE 2 --
-- bucket privado + URLs firmadas -- requiere cambios de código y reescribir
-- las URLs guardadas; ver informe de auditoría.
--
-- Idempotente: se puede correr más de una vez.

-- ── remitos ────────────────────────────────────────────────────────────────
drop policy if exists "public_read_remitos"   on storage.objects;
drop policy if exists "auth_upload_remitos"   on storage.objects;
drop policy if exists "auth_delete_remitos"   on storage.objects;
drop policy if exists "staff_upload_remitos"  on storage.objects;
drop policy if exists "admin_delete_remitos"  on storage.objects;

-- Sube el staff que carga entregas y retiros (admin, encargado, vendedor,
-- concesionario). El repartidor y las cuentas sin rol no.
create policy "staff_upload_remitos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'remitos'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'encargado', 'vendedor', 'concesionario')
  );

-- La app nunca borra remitos: solo admin, por si hay que limpiar a mano.
create policy "admin_delete_remitos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'remitos'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

-- Sin `public_read_remitos` nadie puede listar el bucket con la anon key. Las
-- URLs directas siguen andando (bucket público) y los nombres son
-- timestamp + sufijo aleatorio, no adivinables.

-- Solo fotos y PDF (antes aceptaba cualquier tipo de archivo).
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
where id = 'remitos';

-- ── product-images ─────────────────────────────────────────────────────────
-- Las imágenes del catálogo las sube solo el admin (/admin/productos).
drop policy if exists "Admin upload product images" on storage.objects;
drop policy if exists "Admin update product images" on storage.objects;
drop policy if exists "Admin delete product images" on storage.objects;

create policy "Admin upload product images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

create policy "Admin update product images" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  )
  with check (
    bucket_id = 'product-images'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

create policy "Admin delete product images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select policyname, cmd, roles, qual, with_check from pg_policies
--  where schemaname = 'storage' order by policyname;
-- Esperado: sin `public_read_remitos`; las de escritura con chequeo de rol.
