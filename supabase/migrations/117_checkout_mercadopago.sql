-- 117: checkout de Mercado Pago para los pedidos online.
--
-- Al confirmar un pedido que se paga con Mercado Pago, el servidor crea un checkout (Checkout
-- Pro) y se lo muestra al cliente para que pague con tarjeta o dinero en cuenta, sin que nadie del
-- local tenga que mandarle un link. La orden queda en mercadopago_qr_orders (la misma tabla del QR
-- del mostrador: el aviso de pago de Mercado Pago ya sabe pasar el pedido a "pagado" y registrar la
-- venta). Esta columna guarda el enlace de pago para volver a mostrarlo en la página de seguimiento.

alter table public.mercadopago_qr_orders
  add column if not exists checkout_url text;

comment on column public.mercadopago_qr_orders.checkout_url is
  'Enlace de pago (Checkout Pro) de un pedido online; null en las órdenes de QR del mostrador.';
