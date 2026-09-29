import type { ResultadoPedidoPublico } from "../crear-pedido-publico";
import { formatoPesos } from "./carrito";
import type { DatosCheckout, MedioPago, PasoCheckout, TipoEntrega } from "./estado";

// Checkout del bot: qué se le pregunta al cliente y en qué orden. Todo puro --
// las reglas de negocio (horario, mínimo, stock, precios) las aplica
// crearPedidoPublico, la misma que usa el storefront; acá solo se decide el
// siguiente paso de la conversación.

export type ZonaBot = { id: string; nombre: string; costo: number; etaMin: number; etaMax: number };

export type ConfigCheckout = {
  habilitado: boolean; // sucursal activa y con pedidos online
  retiro:     boolean;
  delivery:   boolean;
  zonas:      ZonaBot[];
};

// Delivery sin ninguna zona cargada no se puede ofrecer (no hay costo ni área).
export function opcionesEntrega(cfg: ConfigCheckout): TipoEntrega[] {
  if (!cfg.habilitado) return [];
  const opciones: TipoEntrega[] = [];
  if (cfg.retiro) opciones.push("retiro_local");
  if (cfg.delivery && cfg.zonas.length > 0) opciones.push("delivery");
  return opciones;
}

export type SiguientePaso =
  | { paso: PasoCheckout; checkout: DatosCheckout }
  | { paso: "listo"; checkout: DatosCheckout }
  | { paso: "no_disponible"; checkout: DatosCheckout };

// Recorre los pasos en orden y devuelve el primero que falta:
// nombre → entrega → (zona → dirección si es envío) → pago → listo.
// Si hay una sola forma de entrega la elige sola.
export function siguientePaso(cfg: ConfigCheckout, nombre: string | null, checkout: DatosCheckout): SiguientePaso {
  const opciones = opcionesEntrega(cfg);
  if (opciones.length === 0) return { paso: "no_disponible", checkout };

  if (!nombre?.trim()) return { paso: "pidiendo_nombre", checkout };

  // Una elección vieja que ya no está disponible se descarta.
  let co: DatosCheckout = checkout.tipo && !opciones.includes(checkout.tipo) ? {} : checkout;
  if (!co.tipo) {
    if (opciones.length > 1) return { paso: "eligiendo_entrega", checkout: co };
    co = { ...co, tipo: opciones[0] };
  }

  if (co.tipo === "delivery") {
    if (!co.zonaId || !cfg.zonas.some((z) => z.id === co.zonaId)) return { paso: "eligiendo_zona", checkout: { ...co, zonaId: undefined } };
    if (!co.direccion) return { paso: "pidiendo_direccion", checkout: co };
  }

  if (!co.pago) return { paso: "eligiendo_pago", checkout: co };
  return { paso: "listo", checkout: co };
}

const TOPE_DIRECCION = 200;
export function limpiarDireccion(texto: string): string {
  return texto.trim().replace(/\s+/g, " ").slice(0, TOPE_DIRECCION);
}

function rangoEta(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null || max == null) return null;
  return min === max ? `${min} min` : `${min}–${max} min`;
}

// Mensaje final al cliente con lo que quedó registrado.
export function textoConfirmacion(
  r: ResultadoPedidoPublico, nombre: string, tipo: TipoEntrega, pago: MedioPago, enlaceSeguimiento: string
): string {
  const lineas = [`¡Gracias, ${nombre}! Tu pedido #${r.numero} quedó registrado.`, ""];
  lineas.push(`Subtotal: ${formatoPesos(r.subtotal ?? 0)}`);
  if (tipo === "delivery") lineas.push(`Envío${r.zona_nombre ? ` (${r.zona_nombre})` : ""}: ${formatoPesos(r.costo_envio ?? 0)}`);
  lineas.push(`Total: ${formatoPesos(r.total ?? 0)}`, "");

  lineas.push(tipo === "delivery" ? "Te lo llevamos a la dirección que nos pasaste." : "Lo retirás en el local.");
  const eta = rangoEta(r.eta_min, r.eta_max);
  if (eta) lineas.push(`Demora estimada: ${eta}.`);

  lineas.push(pago === "efectivo"
    ? (tipo === "delivery" ? "Pagás en efectivo cuando lo recibís." : "Pagás en efectivo cuando lo retirás.")
    : "Pagás con Mercado Pago: el local te manda el link de pago por este chat en unos minutos.");
  lineas.push("", `Seguí tu pedido acá: ${enlaceSeguimiento}`);
  return lineas.join("\n");
}
