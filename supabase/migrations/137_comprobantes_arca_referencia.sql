-- ============================================================================
-- 137 · Referencia del cliente en la factura (orden de compra / expediente)
--
-- Las universidades y organismos públicos piden que su número de orden de compra o expediente figure en la factura.
-- Es un texto libre y opcional que carga quien factura; se imprime en el ticket fiscal. No se envía a ARCA.
--
-- Aditiva: los comprobantes existentes quedan con la referencia vacía.
-- ============================================================================

alter table public.comprobantes_arca
  add column if not exists referencia text;

comment on column public.comprobantes_arca.referencia is
  'N° de orden de compra / expediente del cliente (opcional). Se imprime en el ticket; no se envía a ARCA.';
