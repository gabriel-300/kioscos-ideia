-- Retiros / egresos de efectivo durante el día
CREATE TABLE IF NOT EXISTS retiros_caja (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid          NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  fecha       date          NOT NULL DEFAULT CURRENT_DATE,
  monto       numeric(12,2) NOT NULL CHECK (monto > 0),
  motivo      text          NOT NULL,
  created_by  uuid          REFERENCES auth.users(id),
  created_at  timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE retiros_caja ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_retiros" ON retiros_caja
  FOR ALL USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
  );

CREATE POLICY "encargado_select_retiros" ON retiros_caja
  FOR SELECT USING (
    auth.uid() IN (
      SELECT encargado_user_id FROM sucursales WHERE id = sucursal_id
    )
  );

CREATE POLICY "encargado_insert_retiros" ON retiros_caja
  FOR INSERT WITH CHECK (
    auth.uid() IN (
      SELECT encargado_user_id FROM sucursales WHERE id = sucursal_id
    )
  );
