-- 019: Tabla de proveedores para selección en entregas
CREATE TABLE proveedores (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre     text NOT NULL,
  contacto   text,
  is_active  boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_read_proveedores" ON proveedores
  FOR SELECT USING (
    auth.jwt()->'app_metadata'->>'role' IN ('admin','encargado','vendedor')
  );

CREATE POLICY "admin_all_proveedores" ON proveedores
  FOR ALL USING (
    auth.jwt()->'app_metadata'->>'role' = 'admin'
  );
