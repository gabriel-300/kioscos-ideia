-- Fix 1: agregar fondo_inicial a cierres_caja e incluirlo en la fórmula de diferencia
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS fondo_inicial numeric NOT NULL DEFAULT 0;

ALTER TABLE cierres_caja DROP COLUMN diferencia;
ALTER TABLE cierres_caja ADD COLUMN diferencia numeric GENERATED ALWAYS AS (
  (efectivo_declarado - fondo_inicial) + billetera_declarada
  + COALESCE(tarjeta_declarada, 0) + COALESCE(transferencia_declarada, 0)
  - total_ventas
) STORED;

-- Fix 2: ventas viejas sin medio de pago → asignar todo a pago_efectivo
UPDATE movimientos m
SET pago_efectivo = (
  SELECT COALESCE(SUM(i.subtotal), 0)
  FROM movimiento_items i
  WHERE i.movimiento_id = m.id
)
WHERE m.tipo = 'venta'
  AND m.pago_efectivo IS NULL
  AND m.pago_billetera IS NULL
  AND m.pago_tarjeta IS NULL
  AND m.pago_transferencia IS NULL;
