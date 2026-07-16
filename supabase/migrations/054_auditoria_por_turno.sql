-- La auditoría diaria de stock (migración 049) arrancó como "una por sucursal
-- por día" (unique(sucursal_id, fecha)). El usuario pidió pasarla a "una por
-- turno" -- si en un día hay más de un turno, cada uno audita el suyo, en vez
-- de compartir la auditoría del día entre todos. Motivo propio del negocio:
-- el kiosco en cuestión tiene tiempos muertos y a veces dos personas
-- trabajando en simultáneo, así que el costo de contar más seguido es bajo,
-- y saber en qué turno aparece una diferencia vale más que ahorrarse el
-- conteo extra.

alter table public.auditorias_stock
  add column apertura_id uuid references public.aperturas_caja(id) on delete cascade;

-- Backfill: la única auditoría existente hoy se liga a la apertura que
-- estaba vigente en el momento en que se creó (la más reciente anterior a
-- su created_at, mismo criterio de "turno" que usa el resto del sistema).
update public.auditorias_stock a
set apertura_id = (
  select ap.id from public.aperturas_caja ap
  where ap.sucursal_id = a.sucursal_id and ap.created_at <= a.created_at
  order by ap.created_at desc
  limit 1
)
where a.apertura_id is null;

alter table public.auditorias_stock alter column apertura_id set not null;

alter table public.auditorias_stock drop constraint if exists auditorias_stock_sucursal_id_fecha_key;
alter table public.auditorias_stock
  add constraint auditorias_stock_sucursal_id_apertura_id_key unique (sucursal_id, apertura_id);

create index if not exists auditorias_stock_apertura_idx on public.auditorias_stock (apertura_id);

-- Flag por sucursal para activar el bloqueo de "no se puede cerrar caja sin
-- auditar este turno". Arranca en false en todas las sucursales A PROPÓSITO
-- -- el usuario todavía tiene que capacitar al personal antes de activarlo,
-- así que el mecanismo queda armado pero inactivo hasta que alguien prenda
-- el flag de la sucursal que corresponda.
alter table public.sucursales
  add column auditoria_obligatoria boolean not null default false;
