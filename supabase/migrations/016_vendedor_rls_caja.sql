-- 016: Quitar UNIQUE constraint en aperturas_caja para soportar multi-turno
-- (Las RLS policies para vendedor ya existen desde migraciones previas)
ALTER TABLE aperturas_caja DROP CONSTRAINT IF EXISTS un_apertura_por_dia;
