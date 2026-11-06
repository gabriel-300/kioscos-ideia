-- ============================================================================
-- 133 · Factura A y nota de crédito A (ARCA)
--
-- La 132 solo admitía Factura B (6) y nota de crédito B (8). Cuando un cliente
-- Responsable Inscripto pide Factura A (con su CUIT), el comprobante pasa a
-- código 1 y su nota de crédito a código 3. Se emite SOLO a mano, desde el
-- botón «Facturar» del historial: lo cobrado por medios digitales sigue
-- saliendo solo como Factura B.
--
-- Aditiva: agrega una columna con valor por defecto y ensancha un check.
-- Los comprobantes existentes no cambian.
-- ============================================================================

-- Condición frente al IVA del receptor (FEParamGetCondicionIvaReceptor):
-- 5 = Consumidor Final (la B de siempre), 1 = Responsable Inscripto (la A).
alter table public.comprobantes_arca
  add column if not exists cond_iva_receptor integer not null default 5;

-- Los dos checks que mencionan cbte_tipo se reemplazan (sus nombres son
-- autogenerados, por eso se buscan por contenido).
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.comprobantes_arca'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%cbte_tipo%'
  loop
    execute format('alter table public.comprobantes_arca drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.comprobantes_arca
  add constraint comprobantes_arca_cbte_tipo_chk
  check (cbte_tipo in (1, 3, 6, 8));                 -- 1/6 facturas A/B, 3/8 notas de crédito A/B

alter table public.comprobantes_arca
  add constraint comprobantes_arca_nc_asociada_chk
  check (cbte_tipo not in (3, 8) or comprobante_asociado_id is not null);

-- Una Factura A exige receptor con CUIT (doc_tipo 80) y condición Responsable Inscripto.
alter table public.comprobantes_arca
  add constraint comprobantes_arca_factura_a_chk
  check (cbte_tipo not in (1, 3) or (doc_tipo = 80 and cond_iva_receptor = 1));
