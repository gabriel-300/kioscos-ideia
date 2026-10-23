import type { LineaPedido } from "./lineas";

// Lo que se le muestra al cajero cuando entra un pedido nuevo, y qué pedidos ya
// fueron avisados. Puro y sin imports de servidor: el cliente (el cuadro de aviso)
// y el servidor (que arma el detalle) usan los mismos tipos.

export type PedidoAviso = {
  id:         string;
  numero:     number | null;
  sucursal:   string | null;
  estado:     string;
  cliente:    string | null;
  telefono:   string | null;
  delivery:   boolean;
  direccion:  string | null;
  referencia: string | null;
  mapa:       string | null; // enlace a Google Maps si el cliente compartió su ubicación
  zona:       string | null;
  medioPago:  string | null;
  pagoCon:    number | null;
  notas:      string | null;
  total:      number;
  costoEnvio: number;
  descuento:  number;
  lineas:     LineaPedido[];
};

const PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const pesos = (n: number) => PESOS.format(n);

// Cómo se paga y qué tiene que hacer el cajero con la plata.
export function etiquetaPago(p: Pick<PedidoAviso, "medioPago" | "estado" | "pagoCon" | "total" | "delivery">): string {
  if (p.medioPago === "efectivo") {
    const cobro = `Efectivo: cobrar ${pesos(p.total)} ${p.delivery ? "al entregar" : "al retirar"}`;
    return p.pagoCon && p.pagoCon >= p.total
      ? `${cobro} · paga con ${pesos(p.pagoCon)} (vuelto ${pesos(p.pagoCon - p.total)})`
      : cobro;
  }
  if (p.medioPago === "mercadopago_link") {
    return p.estado === "pendiente_pago"
      ? "Mercado Pago (link): todavía no pagó, mandale el link"
      : "Mercado Pago: ya pagado";
  }
  if (p.medioPago === "mercadopago_qr") return "Mercado Pago (QR)";
  return "Forma de pago sin definir";
}

export function etiquetaEntrega(p: Pick<PedidoAviso, "delivery" | "zona">): string {
  if (!p.delivery) return "Retiro en el local";
  return p.zona ? `Envío a domicilio · ${p.zona}` : "Envío a domicilio";
}

// ── Pedidos ya avisados ────────────────────────────────────────────────
// El navegador recuerda qué pedidos ya vio el cajero (id → cuándo), para no volver
// a mostrar el cuadro por el mismo pedido al recargar. Solo se marca al apretar
// "Entendido": si recarga sin hacerlo, el aviso vuelve (es a propósito).

export type Avisados = Record<string, number>;

export const VIDA_AVISADOS_MS = 2 * 24 * 60 * 60 * 1000;

export function idsNoAvisados(ids: string[], avisados: Avisados): string[] {
  return ids.filter((id) => !(id in avisados));
}

export function marcarAvisados(avisados: Avisados, ids: string[], ahora: number): Avisados {
  const siguiente = { ...avisados };
  for (const id of ids) siguiente[id] = ahora;
  return siguiente;
}

// Los pedidos viejos ya no vuelven a aparecer: se olvidan para que no crezca sin límite.
export function podarAvisados(avisados: Avisados, ahora: number, vidaMs = VIDA_AVISADOS_MS): Avisados {
  return Object.fromEntries(Object.entries(avisados).filter(([, cuando]) => typeof cuando === "number" && ahora - cuando < vidaMs));
}

// Cuando la consulta de pedidos por atender falla (sin red, sesión vencida, o una pestaña que quedó abierta con
// una versión vieja del sitio después de un despliegue), el aviso no puede quedar mudo: a la segunda falla seguida
// avisa en pantalla y, si sigue, recarga la página -- pero no más de una vez cada tanto, para no entrar en un ciclo.
export const FALLAS_PARA_AVISAR = 2;
export const FALLAS_PARA_RECARGAR = 3;
export const ESPERA_ENTRE_RECARGAS_MS = 5 * 60 * 1000;

export function decidirTrasFalla(fallasSeguidas: number, ultimaRecarga: number | null, ahora: number): { mostrarAviso: boolean; recargar: boolean } {
  const mostrarAviso = fallasSeguidas >= FALLAS_PARA_AVISAR;
  const puedeRecargar = ultimaRecarga === null || ahora - ultimaRecarga >= ESPERA_ENTRE_RECARGAS_MS;
  return { mostrarAviso, recargar: fallasSeguidas >= FALLAS_PARA_RECARGAR && puedeRecargar };
}
