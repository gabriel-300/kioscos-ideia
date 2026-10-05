-- 102: Tesorería, "se debe" y anulación. Completa la 101 (la tabla `egresos` está vacía: no hay datos que migrar).
--
-- 1) Compras pendientes de pago. Un egreso puede estar pagado o no:
--      pagado = true   la plata ya salió: tiene origen (de dónde) y fecha_pago (cuándo; = fecha del egreso).
--      pagado = false  se compró pero todavía se debe: sin origen y sin fecha_pago. Después se marca pagado.
--    `fecha` sigue siendo la fecha de la compra/comprobante: el gasto del mes cuenta por `fecha`, esté pagado o no.
--    El efectivo de Tesorería cuenta por `fecha_pago` (solo lo pagado). "Se debe" = suma de los no pagados.
--
-- 2) Anulación en vez de borrado. Un error de carga se anula (queda quién y cuándo); el egreso anulado no cuenta
--    en ningún total y libera los retiros de caja y entregas que tenía vinculados (vuelven a "Para registrar").
--    Nunca se borra una fila de plata.
--
-- Solo agrega columnas y relaja `origen` a opcional (con un CHECK que lo exige cuando está pagado).
-- Idempotente. Correr a mano en el SQL Editor de Supabase, después de la 101.

alter table public.egresos
  add column if not exists pagado     boolean not null default true,
  add column if not exists fecha_pago date,
  add column if not exists anulado_en timestamptz,
  add column if not exists anulado_por uuid references auth.users(id),
  add column if not exists anulado_motivo text;

alter table public.egresos alter column origen drop not null;

-- Lo que ya hubiera quedado como pagado (no hay filas, pero por las dudas) toma su fecha como fecha de pago.
update public.egresos set fecha_pago = fecha where pagado and fecha_pago is null;

alter table public.egresos drop constraint if exists egresos_pago_coherente;
alter table public.egresos add constraint egresos_pago_coherente check (
  (pagado     and origen is not null and fecha_pago is not null)
  or (not pagado and origen is null     and fecha_pago is null)
);

alter table public.egresos drop constraint if exists egresos_anulacion_coherente;
alter table public.egresos add constraint egresos_anulacion_coherente check (
  (anulado_en is null and anulado_por is null and anulado_motivo is null)
  or (anulado_en is not null)
);

-- La bandeja y los totales solo miran egresos vivos; "se debe" mira los pendientes.
create index if not exists egresos_pendientes_idx on public.egresos (proveedor_id) where not pagado and anulado_en is null;
create index if not exists egresos_vivos_fecha_idx on public.egresos (fecha desc) where anulado_en is null;

comment on column public.egresos.pagado      is 'true = la plata ya salió (origen y fecha_pago obligatorios). false = compra pendiente de pago ("se debe").';
comment on column public.egresos.fecha_pago  is 'Cuándo salió la plata. Con pagado = true es obligatoria; el efectivo de Tesorería cuenta por esta fecha.';
comment on column public.egresos.anulado_en  is 'Si no es null, el egreso está anulado: no cuenta en ningún total y libera sus retiros/entregas.';

-- ── Verificación (correr después) ──────────────────────────────────────────
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'egresos'
--  and column_name in ('pagado', 'fecha_pago', 'anulado_en', 'anulado_por', 'anulado_motivo');          -- 5 filas
-- select is_nullable from information_schema.columns where table_name = 'egresos' and column_name = 'origen';  -- YES
-- select conname from pg_constraint where conrelid = 'public.egresos'::regclass and contype = 'c' order by 1;
--   -- debe incluir egresos_pago_coherente y egresos_anulacion_coherente
--
-- Reversión (la tabla está vacía al aplicarla; si ya tiene datos, revisar antes):
--   alter table public.egresos drop constraint if exists egresos_pago_coherente, drop constraint if exists egresos_anulacion_coherente;
--   alter table public.egresos drop column if exists pagado, drop column if exists fecha_pago, drop column if exists anulado_en,
--                              drop column if exists anulado_por, drop column if exists anulado_motivo;
--   alter table public.egresos alter column origen set not null;
