CREATE TABLE IF NOT EXISTS aperturas_caja (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id   UUID        NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  fecha         DATE        NOT NULL,
  fondo_inicial NUMERIC     NOT NULL DEFAULT 0,
  notas         TEXT,
  created_by    UUID        REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT un_apertura_por_dia UNIQUE (sucursal_id, fecha)
);

ALTER TABLE aperturas_caja ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_aperturas" ON aperturas_caja
  FOR ALL USING (
    (auth.jwt() ->> 'app_metadata')::jsonb ->> 'role' = 'admin'
  );

CREATE POLICY "encargado_own_aperturas" ON aperturas_caja
  FOR ALL USING (
    (auth.jwt() ->> 'app_metadata')::jsonb ->> 'role' = 'encargado'
    AND sucursal_id IN (
      SELECT id FROM sucursales WHERE encargado_user_id = auth.uid()
    )
  );
