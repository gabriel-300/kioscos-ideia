import { enviarBotones, enviarLista, enviarTexto } from "@/lib/whatsapp/enviar-mensaje";
import type { GrupoCatalogo } from "../catalogo";
import { formatearCarrito, formatoPesos, type IndiceCatalogo } from "./carrito";
import type { ZonaBot } from "./checkout";
import type { Chat } from "./contexto";
import type { ItemCarrito, TipoEntrega } from "./estado";

// Lo que el bot le manda al cliente y los ids de los botones/filas que
// después vuelven en la respuesta. Los ids son el "protocolo" entre un mensaje
// enviado y el siguiente entrante, por eso viven juntos.

export const ID = {
  categoria:       "cat_",
  masCategorias:   "mascat_",
  masProductos:    "masprod_",
  producto:        "prod_",
  promo:           "promo_",
  seguir:          "accion_seguir",
  finalizar:       "accion_finalizar",
  vaciar:          "accion_vaciar",
  iaConfirmar:     "ia_confirmar",
  iaCancelar:      "ia_cancelar",
  entregaRetiro:   "entrega_retiro",
  entregaDelivery: "entrega_delivery",
  zona:            "zona_",
  pagoEfectivo:    "pago_efectivo",
  pagoMercadoPago: "pago_mp",
} as const;

// Una lista de WhatsApp admite 10 filas: 9 de contenido + 1 de "ver más".
const FILAS_POR_PAGINA = 9;

export function paginar<T>(items: T[], offset: number): { pagina: T[]; siguiente: number | null } {
  const pagina = items.slice(offset, offset + FILAS_POR_PAGINA);
  const siguiente = offset + FILAS_POR_PAGINA < items.length ? offset + FILAS_POR_PAGINA : null;
  return { pagina, siguiente };
}

const texto = (chat: Chat, cuerpo: string) => enviarTexto(chat.phoneNumberId, chat.waId, cuerpo);

// ── Menú ────────────────────────────────────────────────────────────────

export async function enviarCategorias(chat: Chat, grupos: GrupoCatalogo[], offset = 0) {
  if (grupos.length === 0) {
    await texto(chat, "Por ahora no hay productos cargados para pedir. Probá de nuevo más tarde.");
    return;
  }
  const { pagina, siguiente } = paginar(grupos, offset);
  const rows = pagina.map((g) => ({ id: `${ID.categoria}${g.id}`, title: g.name }));
  if (siguiente !== null) rows.push({ id: `${ID.masCategorias}${siguiente}`, title: "Ver más categorías" });
  await enviarLista(chat.phoneNumberId, chat.waId, offset === 0 ? "¡Hola! ¿Qué categoría querés ver?" : "Más categorías:", "Ver categorías", [{ title: "Categorías", rows }]);
}

export async function enviarProductos(chat: Chat, grupo: GrupoCatalogo | undefined, offset: number) {
  if (!grupo || grupo.items.length === 0) {
    await texto(chat, "Esa categoría no tiene productos disponibles ahora.");
    return;
  }
  const { pagina, siguiente } = paginar(grupo.items, offset);
  const rows: { id: string; title: string; description?: string }[] = pagina.map((i) => ({
    id: `${i.esPromo ? ID.promo : ID.producto}${i.id}`,
    title: i.name,
    description: formatoPesos(i.price),
  }));
  if (siguiente !== null) rows.push({ id: `${ID.masProductos}${grupo.id}_${siguiente}`, title: "Ver más productos" });
  await enviarLista(chat.phoneNumberId, chat.waId, "Elegí un producto:", "Ver productos", [{ title: "Productos", rows }]);
}

const BOTONES_CARRITO = [
  { id: ID.seguir,     title: "Seguir comprando" },
  { id: ID.finalizar,  title: "Finalizar pedido" },
  { id: ID.vaciar,     title: "Vaciar carrito" },
];

export async function enviarCarrito(chat: Chat, encabezado: string, carrito: ItemCarrito[], indice: IndiceCatalogo) {
  const { texto: detalle, total } = formatearCarrito(carrito, indice);
  await enviarBotones(chat.phoneNumberId, chat.waId, `${encabezado}\n\nTu pedido:\n${detalle}\n\nTotal: ${formatoPesos(total)}`, BOTONES_CARRITO);
}

export async function enviarPropuestaIA(chat: Chat, propuesta: ItemCarrito[], indice: IndiceCatalogo) {
  const { texto: detalle } = formatearCarrito(propuesta, indice);
  await enviarBotones(chat.phoneNumberId, chat.waId, `Entendí esto:\n${detalle}\n\n¿Lo agrego a tu pedido?`, [
    { id: ID.iaConfirmar, title: "Sí, agregar" },
    { id: ID.iaCancelar,  title: "No" },
  ]);
}

export const mensaje = texto;

// ── Preguntas del checkout ──────────────────────────────────────────────

export const preguntarNombre = (chat: Chat) => texto(chat, "¿A nombre de quién dejo el pedido?");

export const preguntarEntrega = (chat: Chat) =>
  enviarBotones(chat.phoneNumberId, chat.waId, "¿Cómo querés recibirlo?", [
    { id: ID.entregaRetiro,   title: "Retiro en el local" },
    { id: ID.entregaDelivery, title: "Envío a domicilio" },
  ]);

export const preguntarZona = (chat: Chat, zonas: ZonaBot[]) =>
  enviarLista(chat.phoneNumberId, chat.waId, "¿A qué zona te lo llevamos?", "Ver zonas", [{
    title: "Zonas de envío",
    rows: zonas.map((z) => ({
      id: `${ID.zona}${z.id}`,
      title: z.nombre,
      description: `Envío ${formatoPesos(z.costo)} · ${z.etaMin}–${z.etaMax} min`,
    })),
  }]);

export const preguntarDireccion = (chat: Chat) => texto(chat, "Escribime la dirección de entrega (calle, número y alguna referencia).");

export const preguntarPago = (chat: Chat, tipo: TipoEntrega) =>
  enviarBotones(chat.phoneNumberId, chat.waId, "¿Cómo pagás?", [
    { id: ID.pagoEfectivo,    title: tipo === "delivery" ? "Efectivo al recibir" : "Efectivo al retirar" },
    { id: ID.pagoMercadoPago, title: "Mercado Pago" },
  ]);
