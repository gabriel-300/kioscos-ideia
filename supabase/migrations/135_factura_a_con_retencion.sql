-- ============================================================================
-- 135 · Factura A con leyenda «Operación sujeta a retención» (ARCA, códigos 51 y 53)
--
-- ARCA rechaza a la SAS la Factura A común (código 1) con «10000: no autorizado a emitir comprobantes clase A»
-- y el contador indica que sí puede emitir la Factura A con la leyenda «Operación sujeta a retención»
-- (código 51; su nota de crédito es el 53). El cliente que la recibe retiene.
--
-- · Cada emisor tiene una opción: si está activa, su «Factura A» sale como código 51.
-- · comprobantes_arca admite los códigos 51 y 53.
--
-- Aditiva: los comprobantes existentes no cambian.
-- ============================================================================

alter table public.arca_emisores
  add column if not exists factura_a_con_retencion boolean not null default false;

-- Los tres checks que mencionan el tipo de comprobante se reemplazan (nombres de la migración 133).
alter table public.comprobantes_arca drop constraint if exists comprobantes_arca_cbte_tipo_chk;
alter table public.comprobantes_arca drop constraint if exists comprobantes_arca_nc_asociada_chk;
alter table public.comprobantes_arca drop constraint if exists comprobantes_arca_factura_a_chk;

alter table public.comprobantes_arca
  add constraint comprobantes_arca_cbte_tipo_chk
  check (cbte_tipo in (1, 3, 6, 8, 51, 53));          -- A, NC A, B, NC B, A con retención, NC A con retención

alter table public.comprobantes_arca
  add constraint comprobantes_arca_nc_asociada_chk
  check (cbte_tipo not in (3, 8, 53) or comprobante_asociado_id is not null);

-- Toda clase A (común o con retención) exige receptor con CUIT y condición Responsable Inscripto.
alter table public.comprobantes_arca
  add constraint comprobantes_arca_factura_a_chk
  check (cbte_tipo not in (1, 3, 51, 53) or (doc_tipo = 80 and cond_iva_receptor = 1));

-- El emisor de producción (ALS S.A.S.) es el caso que motivó esto: ARCA no le habilita la A común.
update public.arca_emisores
   set factura_a_con_retencion = true
 where cuit = '30719673623' and ambiente = 'produccion';
