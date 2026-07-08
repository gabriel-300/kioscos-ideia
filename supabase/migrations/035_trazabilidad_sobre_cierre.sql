-- Trazabilidad de la plata que sale del kiosco en el "sobre" del cierre
-- (efectivo_declarado - fondo_siguiente): quien lo retiro del kiosco y cuando,
-- y quien lo verifico despues (tesorero/socio) y con que resultado. Sin esto
-- no habia forma de saber donde estaba esa plata entre que se cierra la caja
-- y que se confirma que llego bien.
--
-- sobre_retirado_por / sobre_verificado_por apuntan a auth.users porque los
-- socios/tesorero van a tener su propio usuario admin (no texto libre, para
-- no tener variantes de un mismo nombre en los reportes).

alter table public.cierres_caja
  add column sobre_retirado_por      uuid references auth.users(id),
  add column sobre_retirado_en       timestamptz,
  add column sobre_monto_verificado  numeric,
  add column sobre_verificado_por    uuid references auth.users(id),
  add column sobre_verificado_en     timestamptz,
  add column sobre_notas             text;
