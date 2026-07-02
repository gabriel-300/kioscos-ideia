-- Permitir múltiples aperturas y cierres por día (turnos)
-- Eliminar restricciones de un registro único por día

ALTER TABLE aperturas_caja DROP CONSTRAINT IF EXISTS un_apertura_por_dia;
ALTER TABLE cierres_caja   DROP CONSTRAINT IF EXISTS un_cierre_por_dia;

-- Corregir columna diferencia: incluir todos los medios de pago
ALTER TABLE cierres_caja DROP COLUMN IF EXISTS diferencia;
ALTER TABLE cierres_caja ADD COLUMN diferencia numeric GENERATED ALWAYS AS (
  efectivo_declarado + mercadopago_declarado + COALESCE(tarjeta_declarada, 0) + COALESCE(transferencia_declarada, 0) - total_ventas
) STORED;
