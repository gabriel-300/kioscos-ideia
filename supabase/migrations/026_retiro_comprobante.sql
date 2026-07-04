-- Comprobante de retiro de efectivo (opcional) — mismo patrón de subida de
-- imagen que "Nueva entrega" (movimientos.remito_image_url), pero para
-- retiros_caja. Reutiliza el mismo bucket de Storage "remitos".
alter table public.retiros_caja add column if not exists comprobante_image_url text;
