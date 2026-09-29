// Estado de una conversación del bot de pedidos por WhatsApp.
//
// Vive como JSON en pedidos.bot_paso, en la fila del pedido en estado
// 'carrito' (una por cliente y sucursal). El carrito NO se guarda en
// pedido_items mientras se arma: una promo tiene que verse como UNA línea
// ("2x Combo Mediodía") pero resolverItemsPedido() la expande en componentes.
// pedido_items se escribe una sola vez, al confirmar, desde crearPedidoPublico.

export type ItemCarrito = { id: string; esPromo: boolean; cantidad: number };

export type TipoEntrega = "retiro_local" | "delivery";
export type MedioPago = "efectivo" | "mercadopago_link";

// Lo que el cliente fue eligiendo en el checkout. Todo opcional: la máquina de
// pasos (checkout.ts) decide qué falta.
export type DatosCheckout = {
  tipo?:      TipoEntrega;
  zonaId?:    string;
  direccion?: string;
  pago?:      MedioPago;
};

export const PASOS = [
  "menu", "ia_pendiente",
  "pidiendo_nombre", "eligiendo_entrega", "eligiendo_zona", "pidiendo_direccion", "eligiendo_pago",
] as const;
export type Paso = (typeof PASOS)[number];

export type PasoCheckout = Exclude<Paso, "menu" | "ia_pendiente">;

export type BotState = {
  paso:       Paso;
  carrito:    ItemCarrito[];
  propuesta?: ItemCarrito[]; // solo en ia_pendiente: lo que interpretó la IA, a la espera del "sí"
  checkout:   DatosCheckout;
};

export function estadoInicial(): BotState {
  return { paso: "menu", carrito: [], checkout: {} };
}

export function esPasoCheckout(paso: Paso): paso is PasoCheckout {
  return paso !== "menu" && paso !== "ia_pendiente";
}

// Un bot_paso ausente, corrupto o de una versión anterior arranca de cero en
// vez de romper la conversación.
export function leerEstado(botPaso: string | null): BotState {
  if (!botPaso) return estadoInicial();
  try {
    const p = JSON.parse(botPaso);
    if (p && Array.isArray(p.carrito) && PASOS.includes(p.paso)) {
      return {
        paso: p.paso,
        carrito: p.carrito,
        propuesta: Array.isArray(p.propuesta) ? p.propuesta : undefined,
        checkout: p.checkout && typeof p.checkout === "object" ? p.checkout : {},
      };
    }
  } catch { /* JSON inválido */ }
  return estadoInicial();
}

export function serializarEstado(estado: BotState): string {
  return JSON.stringify(estado);
}
