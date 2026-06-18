-- Vincula un usuario auth al encargado de cada sucursal
ALTER TABLE public.sucursales
  ADD COLUMN IF NOT EXISTS encargado_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sucursales_encargado_user_id_unique
  ON public.sucursales(encargado_user_id)
  WHERE encargado_user_id IS NOT NULL;
