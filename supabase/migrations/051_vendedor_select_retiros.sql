-- Auditoria 15/07, hallazgo medio 07: retiros_caja es la unica tabla
-- scopeada por sucursal que nunca tuvo policy de vendedor (solo admin y
-- encargado, desde la migracion 008) -- a diferencia de movimientos,
-- cierres_caja, aperturas_caja y cta_corriente_pagos, que si tienen el par
-- encargado/vendedor completo.
--
-- No es una fuga de datos (fallaba cerrado: el vendedor simplemente no veia
-- nada), pero es un bug funcional real: sucursales/[id]/page.tsx consulta
-- retiros_caja con el cliente que respeta RLS en una pagina a la que el
-- vendedor si tiene acceso -- el historial de retiros de efectivo de su
-- propio turno le quedaba invisible, incluso los que el mismo registro
-- (retiro-actions.ts ya lo permite via service role, con el chequeo de
-- ownership correcto -- este fix es solo del lado de lectura RLS).

create policy "vendedor_select_retiros" on retiros_caja
  for select using (
    sucursal_id = my_sucursal_id()
  );
