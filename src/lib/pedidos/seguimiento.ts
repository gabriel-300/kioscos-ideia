// Qué le mostramos al cliente en la página de seguimiento de su pedido (y qué
// le avisa el bot por WhatsApp). Puro: solo traduce el estado interno del
// pedido a lenguaje del cliente, sin base ni red.

export type EstadoPaso = "hecho" | "actual" | "pendiente";
export type PasoSeguimiento = { clave: string; label: string; estado: EstadoPaso };

export type Seguimiento = {
  titulo:  string;
  detalle: string;
  pasos:   PasoSeguimiento[]; // vacío si el pedido se cortó (cancelado / vencido)
  final:   boolean;           // ya no va a cambiar: la página deja de refrescarse
};

export type PedidoParaSeguimiento = { estado: string; tipo_entrega: string; medio_pago: string | null };

type Clave = "pago" | "recibido" | "preparando" | "salida" | "entregado";

const TEXTOS: Record<string, { titulo: string; detalle: string }> = {
  pendiente_pago: { titulo: "Esperando tu pago",       detalle: "El local te manda el link de pago por WhatsApp. Cuando lo pagues, empezamos con tu pedido." },
  confirmado:     { titulo: "Recibimos tu pedido",     detalle: "El local lo va a empezar a preparar en breve." },
  pagado:         { titulo: "Pago confirmado",         detalle: "Recibimos tu pago. El local lo va a empezar a preparar en breve." },
  en_preparacion: { titulo: "Estamos preparando tu pedido", detalle: "Ya se está armando." },
  listo_retiro:   { titulo: "¡Tu pedido está listo!",  detalle: "Podés pasar a retirarlo por el local." },
  en_reparto:     { titulo: "Tu pedido va en camino",  detalle: "El repartidor ya salió hacia tu dirección." },
  entregado:      { titulo: "Pedido entregado",        detalle: "¡Gracias por tu compra!" },
  cancelado:      { titulo: "Pedido cancelado",        detalle: "Si tenés dudas, escribile al local." },
  expirado:       { titulo: "El pedido venció",        detalle: "Pasó el tiempo para pagarlo. Podés hacer uno nuevo desde el menú." },
};

// Posición del paso "actual" para cada estado.
const PASO_ACTUAL: Record<string, Clave> = {
  pendiente_pago: "pago",
  confirmado:     "recibido",
  pagado:         "recibido",
  en_preparacion: "preparando",
  listo_retiro:   "salida",
  en_reparto:     "salida",
  entregado:      "entregado",
};

const ESTADOS_FINALES = ["entregado", "cancelado", "expirado"];

export function esEstadoFinal(estado: string): boolean {
  return ESTADOS_FINALES.includes(estado);
}

export function armarSeguimiento(p: PedidoParaSeguimiento): Seguimiento {
  const texto = TEXTOS[p.estado] ?? { titulo: "Estamos procesando tu pedido", detalle: "" };
  const actual = PASO_ACTUAL[p.estado];
  if (!actual) return { ...texto, pasos: [], final: esEstadoFinal(p.estado) };

  const delivery = p.tipo_entrega === "delivery";
  const secuencia: { clave: Clave; label: string }[] = [
    ...(p.medio_pago === "mercadopago_link" ? [{ clave: "pago" as const, label: "Pago" }] : []),
    { clave: "recibido",   label: "Pedido recibido" },
    { clave: "preparando", label: "En preparación" },
    { clave: "salida",     label: delivery ? "En camino" : "Listo para retirar" },
    { clave: "entregado",  label: "Entregado" },
  ];

  const idxActual = secuencia.findIndex((s) => s.clave === actual);
  const pasos = secuencia.map((s, i): PasoSeguimiento => ({
    clave: s.clave,
    label: s.label,
    // Entregado es el cierre: se ve completo, no "en curso".
    estado: p.estado === "entregado" || i < idxActual ? "hecho" : i === idxActual ? "actual" : "pendiente",
  }));

  return { ...texto, pasos, final: esEstadoFinal(p.estado) };
}
