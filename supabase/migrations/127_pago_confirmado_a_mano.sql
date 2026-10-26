-- 127: quién confirmó el pago de un pedido online y cómo.
--
-- Un pedido pagado con Mercado Pago pasa a "pagado" solo, cuando llega el aviso de Mercado Pago. Si ese aviso
-- falla, un ADMINISTRADOR lo puede confirmar a mano desde Tenteo. Antes ese botón creía lo que le decía la
-- persona; ahora primero consulta a Mercado Pago, y deja acá el rastro:
--   pago_confirmacion = 'mercadopago'  -> Mercado Pago mostró un pago aprobado por el importe del pedido
--   pago_confirmacion = 'manual'       -> Mercado Pago no lo mostró y el administrador lo confirmó igual, con motivo
-- Sin esto no hay forma de saber después qué ventas online se confirmaron a mano.

alter table public.pedidos
  add column if not exists pago_confirmado_por     uuid references auth.users(id),
  add column if not exists pago_confirmado_en      timestamptz,
  add column if not exists pago_confirmacion       text check (pago_confirmacion in ('mercadopago', 'manual')),
  add column if not exists pago_confirmacion_motivo text;
