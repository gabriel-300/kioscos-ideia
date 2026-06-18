-- Cierre de caja diario por sucursal
CREATE TABLE IF NOT EXISTS cierres_caja (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id            UUID        NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  fecha                  DATE        NOT NULL,
  total_ventas           NUMERIC     NOT NULL DEFAULT 0,
  efectivo_declarado     NUMERIC     NOT NULL DEFAULT 0,
  mercadopago_declarado  NUMERIC     NOT NULL DEFAULT 0,
  diferencia             NUMERIC     GENERATED ALWAYS AS (
                           efectivo_declarado + mercadopago_declarado - total_ventas
                         ) STORED,
  notas                  TEXT,
  created_by             UUID        REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT un_cierre_por_dia UNIQUE (sucursal_id, fecha)
);

ALTER TABLE cierres_caja ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_cierres" ON cierres_caja
  FOR ALL USING (
    (auth.jwt() ->> 'app_metadata')::jsonb ->> 'role' = 'admin'
  );

CREATE POLICY "encargado_own_cierres" ON cierres_caja
  FOR ALL USING (
    (auth.jwt() ->> 'app_metadata')::jsonb ->> 'role' = 'encargado'
    AND sucursal_id IN (
      SELECT id FROM sucursales WHERE encargado_user_id = auth.uid()
    )
  );
