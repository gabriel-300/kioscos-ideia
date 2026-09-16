// Interpreta texto libre de WhatsApp ("quiero 2 medialunas y un café") como
// una PROPUESTA de items del carrito -- nunca escribe nada directo, ver
// bot-whatsapp.ts para cómo se confirma. Mismo patrón que src/lib/groq.ts
// (fetch directo, JSON mode con json_schema, sin SDK), mismo modelo ya
// verificado funcionando en la cuenta real (qwen/qwen3.6-27b) -- no se
// introduce un modelo nuevo sin probar, groq.ts ya documenta que otros
// modelos de esta cuenta devuelven 404.
//
// A diferencia de la lectura de comprobantes (que alimenta datos contables
// y por eso queda con advertencias para revisión humana), acá el resultado
// NUNCA se usa solo: cada id que devuelve el modelo se valida contra el
// catálogo real server-side antes de proponerse, y la propuesta todavía
// necesita que el cliente la confirme tocando un botón -- la IA no puede
// hacer que se cobre algo que no coincide con el catálogo real.

const MODELO = "qwen/qwen3.6-27b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

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
          id:       { type: "string" },
          cantidad: { type: "number" },
        },
        required: ["id", "cantidad"],
      },
    },
  },
  required: ["items"],
} as const;

function limpiarRespuesta(raw: string): string {
  const sinThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const sinMarkdown = sinThink.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  return sinMarkdown || sinThink || raw;
}

// Devuelve [] si no hay API key, si el modelo no entendió nada, o si hubo
// cualquier error -- nunca lanza. El llamador (bot-whatsapp.ts) ya sabe
// tratar "sin propuesta" como "mostrar categorías", no hace falta
// distinguir la causa acá.
export async function interpretarPedidoConIA(texto: string, catalogo: ItemCatalogoIA[]): Promise<ItemPropuestoIA[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !texto.trim() || catalogo.length === 0) return [];

  const catalogoTexto = catalogo
    .map((c) => `${c.id} | ${c.name} | $${c.price}${c.esPromo ? " (promo)" : ""}`)
    .join("\n");

  const systemPrompt =
    "Sos el asistente de pedidos de un kiosco por WhatsApp. Interpretás lo que pide un cliente y devolvés SOLO productos que existan en el catálogo que te paso, usando el id EXACTO tal cual aparece ahí. Si el cliente pide algo que no está en el catálogo, o el mensaje no es un pedido, devolvé items: []. Nunca inventes un id que no esté en la lista.";

  const userPrompt = `Catálogo disponible (id | nombre | precio):\n${catalogoTexto}\n\nMensaje del cliente: "${texto}"\n\nDevolvé los items pedidos con su cantidad (si no dice cantidad, asumí 1).`;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODELO,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        reasoning_effort: "none", // evita el bloque <think> de qwen3.6-27b, ver groq.ts
        response_format: { type: "json_schema", json_schema: { name: "items_pedido", schema: JSON_SCHEMA } },
      }),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw) return [];

    const parsed = JSON.parse(limpiarRespuesta(raw)) as { items?: { id?: unknown; cantidad?: unknown }[] };
    if (!Array.isArray(parsed.items)) return [];

    const catalogoMap = new Map(catalogo.map((c) => [c.id, c]));
    const propuesta: ItemPropuestoIA[] = [];
    for (const item of parsed.items) {
      if (typeof item.id !== "string" || typeof item.cantidad !== "number") continue;
      const real = catalogoMap.get(item.id);
      if (!real) continue; // el modelo devolvió un id que no existe de verdad -- se descarta, no se propone
      if (!(item.cantidad > 0)) continue;
      propuesta.push({ id: real.id, esPromo: real.esPromo, cantidad: Math.min(item.cantidad, 50) });
    }
    return propuesta;
  } catch {
    return [];
  }
}
