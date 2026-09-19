-- 097: tope de 1 MB por archivo en el bucket product-images (Cached Egress de Supabase al 168%, 2026-09-19).
--
-- El bucket tenía 3 PNG de ~2 MB (uno en un producto activo) y aceptaba hasta 5 MB. La misma regla la aplica el
-- cargador de imágenes en la pantalla (src/lib/imagen.ts, REQUISITOS_IMAGEN: JPG/PNG/WebP, hasta 1 MB, mínimo
-- 400 px de lado); esto la hace cumplir también en la base, por si alguien la saltea desde el navegador.
--
-- No toca los archivos que ya están subidos. Idempotente. Correr a mano en el SQL Editor de Supabase.
--
-- Verificación después:
--   select id, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-images';
--   -- debe dar 1048576 y {image/jpeg,image/png,image/webp}

update storage.buckets
set file_size_limit = 1048576
where id = 'product-images';
