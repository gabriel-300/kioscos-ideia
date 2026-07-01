-- Proveedor y número de remito/factura en movimientos de entrega
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS proveedor text;
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS nro_remito text;
