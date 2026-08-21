-- Módulo de Tesorería, paso 2/8: "Socios" (Damián, Javier, Gabriel) son del
-- negocio entero, no de una sucursal puntual -- a diferencia del selector de
-- empleados de Cta. Corriente (filtrado por profiles.sucursal_id), el
-- selector de socios necesita listarlos en CUALQUIER sucursal. Este flag
-- deja marcar quién es socio sin depender de a qué sucursal esté atado su
-- perfil.

alter table public.profiles
  add column if not exists es_socio boolean not null default false;
