-- 018: Función atómica para crear movimiento + items en una sola transacción
CREATE OR REPLACE FUNCTION crear_movimiento_con_items(
  p_sucursal_id        uuid,
  p_fecha              date,
  p_tipo               text,
  p_notas              text    DEFAULT NULL,
  p_proveedor          text    DEFAULT NULL,
  p_nro_remito         text    DEFAULT NULL,
  p_canal              text    DEFAULT 'consumidor_final',
  p_personal_id        uuid    DEFAULT NULL,
  p_pago_efectivo      numeric DEFAULT NULL,
  p_pago_billetera     numeric DEFAULT NULL,
  p_pago_tarjeta       numeric DEFAULT NULL,
  p_pago_transferencia numeric DEFAULT NULL,
  p_created_by         uuid    DEFAULT NULL,
  p_items              jsonb   DEFAULT '[]'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_movimiento_id uuid;
  v_item          jsonb;
BEGIN
  INSERT INTO movimientos (
    sucursal_id, fecha, tipo, notas, proveedor, nro_remito,
    canal, personal_id,
    pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia,
    created_by
  ) VALUES (
    p_sucursal_id, p_fecha, p_tipo, p_notas, p_proveedor, p_nro_remito,
    p_canal, p_personal_id,
    p_pago_efectivo, p_pago_billetera, p_pago_tarjeta, p_pago_transferencia,
    p_created_by
  )
  RETURNING id INTO v_movimiento_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO movimiento_items (movimiento_id, product_id, cantidad, precio_unitario, subtotal)
    VALUES (
      v_movimiento_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'cantidad')::numeric,
      NULLIF(v_item->>'precio_unitario', 'null')::numeric,
      NULLIF(v_item->>'subtotal',        'null')::numeric
    );
  END LOOP;

  RETURN v_movimiento_id;
END;
$$;
