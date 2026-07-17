-- Algunos proveedores facturan al precio sugerido de venta al publico (ej.
-- panificados) y hay que restarle el % de descuento que nos hacen para saber
-- el costo real; otros facturan directo al costo. Se necesita saber esto para
-- poder interpretar automaticamente lo que lee la IA de la foto del remito
-- (ver lectura de remitos por foto).

alter table public.proveedores
  add column modo_facturacion text not null default 'costo'
    check (modo_facturacion in ('costo', 'precio_sugerido')),
  add column porcentaje_descuento numeric
    check (porcentaje_descuento is null or (porcentaje_descuento >= 0 and porcentaje_descuento <= 100));
