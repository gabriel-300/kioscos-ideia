import { completarJson } from "@/lib/ia/completar-json";

// Atajo del bot de WhatsApp: interpreta texto libre ("dame 2 alfajores y un
// café") contra el catálogo real de la sucursal. La IA NUNCA escribe el
// carrito: solo propone, y el cliente confirma con un botón (ver
// bot/procesar.ts).
//
// Al modelo se le pasa el catálogo con un NÚMERO por línea, no con el id: un
// uuid pesa ~20 tokens y con ~240 productos el prompt pasaba el tope de 8000
// tokens/minuto del plan gratuito de Groq; y con números el modelo no puede
// inventar un id. Todo número fuera de rango se descarta.

export type ItemCatalogoIA = { id: string; name: string; price: number; esPromo: boolean };

export type ItemPropuestoIA = { id: string; esPromo: boolean; cantidad: number };

const JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          numero:   { type: "integer" },
          cantidad: { type: "number" },
        },
        required: ["numero", "cantidad"],
      },
    },
  },
  required: ["items"],
} as const;

const MAX_CANTIDAD = 50;
const MAX_TEXTO = 500;

const SISTEMA =
  "Sos el asistente de pedidos de un kiosco por WhatsApp. Interpretás lo que pide un cliente y devolvés SOLO productos que existan en el catálogo que te paso, identificados por su NÚMERO tal cual aparece ahí. Si el cliente pide algo que no está en el catálogo, o el mensaje no es un pedido, devolvé items: []. Nunca inventes un número que no esté en la lista.";

// Devuelve [] si no se entendió nada o si la IA no está disponible (ninguna
// respuesta útil de la cadena): el bot lo trata como "mostrar categorías".
export async function interpretarPedidoConIA(texto: string, catalogo: ItemCatalogoIA[]): Promise<ItemPropuestoIA[]> {
  if (!texto.trim() || catalogo.length === 0) return [];

  const lista = catalogo
    .map((c, i) => `${i + 1} | ${c.name}${c.esPromo ? " (promo)" : ""}`)
    .join("\n");
  const usuario = `Catálogo disponible (número | nombre):\n${lista}\n\nMensaje del cliente: ${JSON.stringify(texto.trim().slice(0, MAX_TEXTO))}\n\nDevolvé los items pedidos con su número y cantidad (si no dice cantidad, asumí 1).`;

  try {
    const { valor } = await completarJson(
      { sistema: SISTEMA, usuario, schema: JSON_SCHEMA, nombreSchema: "items_pedido", maxTokens: 1024, temperatura: 0.1 },
      (t) => {
        const parsed = JSON.parse(t) as { items?: unknown };
        if (!Array.isArray(parsed.items)) throw new Error("la respuesta no trae items");
        return parsed.items as { numero?: unknown; cantidad?: unknown }[];
      }
    );

    const propuesta: ItemPropuestoIA[] = [];
    for (const it of valor) {
      if (typeof it.numero !== "number" || typeof it.cantidad !== "number") continue;
      const real = catalogo[it.numero - 1]; // número inventado o fuera de rango: no existe
      if (!real || !(it.cantidad > 0)) continue;
      propuesta.push({ id: real.id, esPromo: real.esPromo, cantidad: Math.min(it.cantidad, MAX_CANTIDAD) });
    }
    return propuesta;
  } catch {
    return []; // ya quedó logueado el motivo de cada eslabón en completarJson
  }
}
