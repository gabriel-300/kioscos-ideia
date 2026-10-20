// Con qué se puede pagar un pedido online. Hoy solo con Mercado Pago (tarjeta, débito o dinero en
// cuenta): el cobro es automático y no hay plata que rendir en la puerta. Para volver a aceptar
// efectivo basta con poner esto en true: la tienda, el bot y el servidor lo respetan juntos.
const ACEPTA_EFECTIVO = false;

export function aceptaEfectivoOnline(): boolean {
  return ACEPTA_EFECTIVO;
}
