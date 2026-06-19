-- Agrega tarjeta y transferencia al cierre de caja
-- y recalcula la columna generada diferencia para incluir todos los medios

ALTER TABLE cierres_caja
  ADD COLUMN IF NOT EXISTS tarjeta_declarada     NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferencia_declarada NUMERIC NOT NULL DEFAULT 0;

-- La columna diferencia es GENERATED ALWAYS AS STORED; hay que reemplazarla
ALTER TABLE cierres_caja DROP COLUMN IF EXISTS diferencia;

ALTER TABLE cierres_caja
  ADD COLUMN diferencia NUMERIC GENERATED ALWAYS AS (
    efectivo_declarado
    + mercadopago_declarado
    + tarjeta_declarada
    + transferencia_declarada
    - total_ventas
  ) STORED;
