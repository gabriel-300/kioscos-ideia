-- 017: Corregir ventas donde pago_efectivo fue guardado como importe bruto
-- (lo que dio el cliente en mano) en vez de neto (bruto - vuelto).
-- Ocurre cuando el browser usa el bundle viejo despues de un deploy.
-- La corrección recalcula pago_efectivo = total_items - otros_medios para cada venta afectada.
UPDATE movimientos m
SET pago_efectivo = GREATEST(0,
  (SELECT COALESCE(SUM(i.subtotal), 0)
   FROM movimiento_items i
   WHERE i.movimiento_id = m.id)
  - COALESCE(m.pago_billetera, 0)
  - COALESCE(m.pago_tarjeta, 0)
  - COALESCE(m.pago_transferencia, 0)
)
WHERE m.tipo = 'venta'
  AND m.pago_efectivo IS NOT NULL
  AND m.pago_efectivo > (
    SELECT COALESCE(SUM(i.subtotal), 0)
           - COALESCE(m.pago_billetera, 0)
           - COALESCE(m.pago_tarjeta, 0)
           - COALESCE(m.pago_transferencia, 0)
    FROM movimiento_items i
    WHERE i.movimiento_id = m.id
  );
