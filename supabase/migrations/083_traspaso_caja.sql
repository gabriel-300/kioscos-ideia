-- ============================================================
-- TRASPASO DE TURNO (checkpoint de custodia, sin cerrar la caja)
-- Correr en Supabase → SQL Editor → New query → Run
--
-- Hoy la caja SOLO puede cambiar de manos cerrando (cerrar_caja) y volviendo
-- a abrir (abrir_caja) -- eso sigue existiendo tal cual, para el multi-turno
-- real. Pero para un simple cambio de persona durante el mismo turno es
-- demasiado pesado (corta la conciliación, asigna numero_liquidacion, etc.).
-- Esto agrega una alternativa liviana: quien RECIBE la caja cuenta el
-- efectivo real, el sistema le dice si hay diferencia contra lo esperado, y
-- queda un registro -- pero aperturas_caja NO se toca, el turno sigue
-- abierto y los movimientos siguen entrando al mismo turno de siempre.
--
-- Pedido textual del usuario: "quiero que quede registro, y el que recibe
-- que diga si hay alguna diferencia. y coloque el valor real."
-- ============================================================

-- ── 1) Tabla ─────────────────────────────────────────────────────────
create table public.traspasos_caja (
  id                uuid primary key default gen_random_uuid(),
  apertura_id       uuid not null references public.aperturas_caja(id) on delete cascade,
  sucursal_id       uuid not null references public.sucursales(id) on delete cascade,
  entregado_por     uuid references auth.users(id),
  recibido_por      uuid not null references auth.users(id),
  efectivo_esperado numeric not null,
  efectivo_real     numeric not null,
  diferencia        numeric generated always as (efectivo_real - efectivo_esperado) stored,
  notas             text,
  created_at        timestamptz not null default now()
);

create index traspasos_caja_apertura_idx on public.traspasos_caja (apertura_id, created_at desc);
create index traspasos_caja_sucursal_idx on public.traspasos_caja (sucursal_id);

alter table public.traspasos_caja enable row level security;

-- Solo lectura para encargado/vendedor -- a propósito SIN policy de INSERT
-- para ellos (a diferencia de retiros_caja, que todavía arrastra una de la
-- migración 008): la única vía de escritura tiene que ser la RPC de abajo,
-- si no cualquiera podría saltear el cálculo server-side de
-- efectivo_esperado y la nota obligatoria pegándole directo a la REST API
-- con devtools -- mismo hueco que cerró la migración 030 para
-- aperturas_caja/cierres_caja.
create policy "traspasos_caja_select" on public.traspasos_caja
  for select to authenticated
  using (
    is_admin()
    or sucursal_id in (select id from public.sucursales where encargado_user_id = auth.uid())
    or sucursal_id = my_sucursal_id()
  );

create policy "traspasos_caja_admin_write" on public.traspasos_caja
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ── 2) RPC registrar_traspaso_caja ──────────────────────────────────
-- Mismo candado que abrir_caja/cerrar_caja (pg_advisory_xact_lock por
-- sucursal). NO inserta en aperturas_caja ni cierres_caja -- el turno sigue
-- abierto. entregado_por se determina server-side (nunca del cliente): el
-- recibido_por del ÚLTIMO traspaso de este turno, o si no hubo ninguno
-- todavía, quien abrió la caja.
--
-- efectivo_esperado usa el mismo criterio de canales que cerrar_caja /
-- cierre-actions.ts: se excluyen explícitamente cuenta_corriente y
-- pedido_ya_plataforma de la suma de pago_efectivo -- NO alcanza con asumir
-- que pago_efectivo ya viene null para esos canales, porque
-- crear_movimiento_con_items nunca lo fuerza server-side, solo lo hace la
-- UI (venta-rapida-form.tsx) por convención.
create or replace function public.registrar_traspaso_caja(
  p_sucursal_id   uuid,
  p_efectivo_real numeric,
  p_notas         text,
  p_recibido_por  uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id                    uuid;
  v_apertura_id           uuid;
  v_apertura_created_at   timestamptz;
  v_apertura_created_by   uuid;
  v_apertura_fondo        numeric;
  v_ultimo_cierre         timestamptz;
  v_entregado_por         uuid;
  v_ventas_efectivo       numeric;
  v_retiros_turno         numeric;
  v_retiros_socio_turno   numeric;
  v_pagos_proveedor_turno numeric;
  v_pagos_ctc_turno       numeric;
  v_pagos_socio_turno     numeric;
  v_efectivo_esperado     numeric;
  v_diferencia            numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_sucursal_id::text));

  select id, created_at, created_by, fondo_inicial
    into v_apertura_id, v_apertura_created_at, v_apertura_created_by, v_apertura_fondo
  from aperturas_caja where sucursal_id = p_sucursal_id
  order by created_at desc limit 1;

  if v_apertura_id is null then
    raise exception 'No hay apertura de caja registrada';
  end if;

  select created_at into v_ultimo_cierre
  from cierres_caja where sucursal_id = p_sucursal_id
  order by created_at desc limit 1;

  if v_ultimo_cierre is not null and v_ultimo_cierre >= v_apertura_created_at then
    raise exception 'No hay una caja abierta para traspasar';
  end if;

  -- Quién tiene la caja ahora mismo: el último que la recibió en este turno,
  -- o quien lo abrió si todavía no hubo ningún traspaso.
  select recibido_por into v_entregado_por
  from traspasos_caja
  where apertura_id = v_apertura_id
  order by created_at desc limit 1;
  v_entregado_por := coalesce(v_entregado_por, v_apertura_created_by);

  select coalesce(sum(m.pago_efectivo), 0) into v_ventas_efectivo
  from movimientos m
  where m.sucursal_id = p_sucursal_id
    and m.tipo = 'venta'
    and m.anulado_en is null
    and m.canal not in ('cuenta_corriente', 'pedido_ya_plataforma')
    and m.created_at >= v_apertura_created_at;

  select coalesce(sum(monto), 0) into v_retiros_turno
  from retiros_caja
  where sucursal_id = p_sucursal_id and created_at >= v_apertura_created_at;

  select coalesce(sum(monto), 0) into v_retiros_socio_turno
  from movimientos_socio
  where sucursal_id = p_sucursal_id and created_at >= v_apertura_created_at;

  select coalesce(sum(monto_efectivo), 0) into v_pagos_proveedor_turno
  from pagos_proveedor
  where sucursal_id = p_sucursal_id and created_at >= v_apertura_created_at;

  select coalesce(sum(monto_efectivo), 0) into v_pagos_ctc_turno
  from cta_corriente_pagos
  where sucursal_id = p_sucursal_id and created_at >= v_apertura_created_at;

  select coalesce(sum(monto_efectivo), 0) into v_pagos_socio_turno
  from pagos_socio
  where sucursal_id = p_sucursal_id and created_at >= v_apertura_created_at;

  -- Mismos signos que cerrar_caja (080): retiros y pagos a proveedor SALEN
  -- de la caja; cobros de Cta. Corriente y devoluciones de socio ENTRAN.
  v_efectivo_esperado := v_apertura_fondo
    + v_ventas_efectivo
    - v_retiros_turno
    - v_retiros_socio_turno
    - v_pagos_proveedor_turno
    + v_pagos_ctc_turno
    + v_pagos_socio_turno;

  v_diferencia := p_efectivo_real - v_efectivo_esperado;

  if v_diferencia <> 0 and trim(coalesce(p_notas, '')) = '' then
    raise exception 'Hay una diferencia de caja -- contá qué pasó en las notas antes de traspasar';
  end if;

  insert into traspasos_caja (
    apertura_id, sucursal_id, entregado_por, recibido_por,
    efectivo_esperado, efectivo_real, notas
  ) values (
    v_apertura_id, p_sucursal_id, v_entregado_por, p_recibido_por,
    v_efectivo_esperado, p_efectivo_real, p_notas
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.registrar_traspaso_caja(uuid, numeric, text, uuid) from public, anon, authenticated;
grant  execute on function public.registrar_traspaso_caja(uuid, numeric, text, uuid) to service_role, postgres;

-- ── 3) movimiento_visible_por_turno: reconocer al tenedor por traspaso ──
-- Sin esto, alguien que recibe una caja ya abierta (no la abrió él) no ve
-- el turno completo bajo "cada uno ve su turno" (036/041) -- en
-- movimientos ve al menos lo que ÉL creó (parche de 041), pero en
-- auditorias_stock/auditoria_stock_items (056, que reusa esta misma
-- función sin ese parche) no vería literalmente nada.
create or replace function public.movimiento_visible_por_turno(
  p_sucursal_id uuid,
  p_fecha       date,
  p_created_at  timestamptz
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when p_fecha <> (now() at time zone 'America/Argentina/Buenos_Aires')::date then true
    else exists (
      select 1
      from public.aperturas_caja a
      where a.sucursal_id = p_sucursal_id
        and a.fecha        = p_fecha
        and a.created_at  <= p_created_at
        and p_created_at  < coalesce(
              (select min(c.created_at) from public.cierres_caja c
               where c.sucursal_id = p_sucursal_id and c.created_at > a.created_at),
              'infinity'::timestamptz
            )
        and (
          a.created_by = auth.uid()
          or exists (
            select 1 from public.traspasos_caja t
            where t.apertura_id = a.id and t.recibido_por = auth.uid()
          )
        )
    )
    end;
$$;
