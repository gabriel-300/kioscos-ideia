-- Módulo de Tesorería, fix 1/8: cta_corriente_pagos solo tenía "monto" (sin
-- medio de pago), así que nunca podía afectar la conciliación de caja aunque
-- el pago fuera en efectivo real sacado/puesto en el cajón. Se agregan
-- monto_efectivo/monto_billetera en vez de un enum medio_pago único -- permite
-- pago combinado (ej. $500 efectivo + $300 billetera en un mismo pago) y es
-- el mismo shape que movimientos ya usa para ventas (pago_efectivo/
-- pago_billetera/pago_tarjeta/pago_transferencia). Las tablas nuevas de este
-- módulo (pagos_proveedor, pagos_socio) nacen con esta misma forma desde el
-- vamos para no tener que retrofitearlas después.
--
-- monto queda como columna legacy, ahora GENERATED (no se puede escribir
-- directo) para que el histórico y cualquier código viejo que la lea siga
-- funcionando sin cambios, pero ya no puede desincronizarse de la suma real.
-- Backfill: todo lo histórico se asume efectivo (monto_efectivo = monto,
-- monto_billetera = 0) -- supuesto razonable pero no verificado contra los
-- pagos reales anteriores; conviene que el usuario lo revise una vez
-- aplicada, ya que la columna generada no se puede reescribir después.

alter table public.cta_corriente_pagos
  add column if not exists monto_efectivo  numeric not null default 0 check (monto_efectivo >= 0),
  add column if not exists monto_billetera numeric not null default 0 check (monto_billetera >= 0);

update public.cta_corriente_pagos
set monto_efectivo = monto
where monto_efectivo = 0 and monto_billetera = 0 and monto > 0;

alter table public.cta_corriente_pagos drop column monto;
alter table public.cta_corriente_pagos add column monto numeric generated always as (monto_efectivo + monto_billetera) stored;

alter table public.cta_corriente_pagos
  add constraint cta_corriente_pagos_monto_positivo check (monto_efectivo + monto_billetera > 0);
