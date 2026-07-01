-- 012: Rol vendedor — vincula personal a sucursal y registra quien toma cta/cte

-- sucursal_id en profiles: todos los empleados (encargado + vendedor) quedan ligados a una sucursal
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.sucursales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_sucursal_id_idx ON public.profiles(sucursal_id);

-- personal_id en movimientos: solo se usa cuando canal = 'cuenta_corriente'
ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS personal_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
