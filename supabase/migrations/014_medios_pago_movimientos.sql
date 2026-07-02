-- Agregar columnas de medios de pago a movimientos (solo para tipo = 'venta')
ALTER TABLE movimientos
  ADD COLUMN pago_efectivo      numeric,
  ADD COLUMN pago_billetera     numeric,
  ADD COLUMN pago_tarjeta       numeric,
  ADD COLUMN pago_transferencia numeric;

-- Renombrar mercadopago_declarado → billetera_declarada en cierres_caja
ALTER TABLE cierres_caja RENAME COLUMN mercadopago_declarado TO billetera_declarada;

-- Recalcular diferencia con el nuevo nombre de columna
ALTER TABLE cierres_caja DROP COLUMN diferencia;
ALTER TABLE cierres_caja ADD COLUMN diferencia numeric GENERATED ALWAYS AS (
  efectivo_declarado + billetera_declarada + COALESCE(tarjeta_declarada, 0) + COALESCE(transferencia_declarada, 0) - total_ventas
) STORED;
